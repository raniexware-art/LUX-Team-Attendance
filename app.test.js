const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");
const { createAppServer } = require("./server");

let server;
let baseUrl;
let dataDirectory;
let cookie;
let csrfToken;
let adminRecoveryCode;

function request(route, { method = "GET", body, token = csrfToken } = {}) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers["X-CSRF-Token"] = token;
    const req = http.request(`${baseUrl}${route}`, { method, headers }, (res) => {
      let responseBody = "";
      res.on("data", (chunk) => { responseBody += chunk; });
      res.on("end", () => {
        if (res.headers["set-cookie"]) cookie = res.headers["set-cookie"][0].split(";")[0];
        resolve({ status: res.statusCode, body: responseBody ? JSON.parse(responseBody) : null });
      });
    });
    req.on("error", reject);
    if (body !== undefined) req.write(JSON.stringify(body));
    req.end();
  });
}

before(async () => {
  dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "teamtime-test-"));
  server = createAppServer({ dataFile: path.join(dataDirectory, "store.json") });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const session = await request("/api/session");
  csrfToken = session.body.csrfToken;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dataDirectory, { recursive: true, force: true });
});

test("uses DATA_FILE when no explicit data file is provided", () => {
  const configuredDataFile = path.join(dataDirectory, "configured-store.json");
  fs.writeFileSync(configuredDataFile, "{invalid json");
  const previousDataFile = process.env.DATA_FILE;
  process.env.DATA_FILE = configuredDataFile;
  try {
    assert.throws(() => createAppServer(), SyntaxError);
  } finally {
    if (previousDataFile === undefined) delete process.env.DATA_FILE;
    else process.env.DATA_FILE = previousDataFile;
  }
});

test("first-run admin setup creates an admin session and blocks another setup", async () => {
  const setup = await request("/api/setup", { method: "POST", body: { username: "admin", password: "admin-password-123" } });
  assert.equal(setup.status, 201);
  const session = await request("/api/session");
  csrfToken = session.body.csrfToken;
  assert.equal(session.body.user.role, "admin");
  const recovery = await request("/api/admin/recovery-code", { method: "POST", body: {} });
  assert.equal(recovery.status, 201);
  adminRecoveryCode = recovery.body.recoveryCode;
  assert.equal((await request("/api/setup", { method: "POST", body: { username: "other", password: "another-password-123" } })).status, 409);
});

test("serves frontend assets without exposing project data files", async () => {
  const get = (route) => new Promise((resolve, reject) => {
    const req = http.get(`${baseUrl}${route}`, (res) => {
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode, contentType: res.headers["content-type"] }));
    });
    req.on("error", reject);
  });

  const responses = await Promise.all([
    get("/"),
    get("/styles.css"),
    get("/app.js"),
    get("/lux-decibels-logo.png"),
    get("/logowhit.png"),
    get("/store.json"),
  ]);
  assert.deepEqual(responses.slice(0, 5).map(({ status }) => status), [200, 200, 200, 200, 200]);
  assert.equal(responses[0].contentType, "text/html; charset=utf-8");
  assert.equal(responses[1].contentType, "text/css; charset=utf-8");
  assert.equal(responses[2].contentType, "text/javascript; charset=utf-8");
  assert.equal(responses[3].contentType, "image/png");
  assert.equal(responses[4].contentType, "image/png");
  assert.equal(responses[5].status, 404);
});

test("admin creates employees; employee role can only record valid check-in/check-out transitions", async () => {
  const create = await request("/api/employees", {
    method: "POST",
    body: { name: "Riley Employee", employeeId: "EMP-1", password: "employee-password-123" },
  });
  assert.equal(create.status, 201);
  assert.equal((await request(`/api/employees/${create.body.employee.id}/password`, {
    method: "PATCH",
    body: { password: "employee-password-reset-123" },
  })).status, 200);
  const employeeRecord = JSON.parse(fs.readFileSync(path.join(dataDirectory, "store.json"), "utf8")).employees[0];
  assert.equal(employeeRecord.passwordHash.includes("employee-password-reset-123"), false);

  assert.equal((await request("/api/attendance", { method: "POST", body: { type: "check-in" } })).status, 403);
  await request("/api/logout", { method: "POST", body: {} });
  const session = await request("/api/session");
  csrfToken = session.body.csrfToken;
  assert.equal((await request("/api/login", {
    method: "POST",
    body: { role: "employee", identifier: "EMP-1", password: "employee-password-123" },
  })).status, 401);
  const login = await request("/api/login", {
    method: "POST",
    body: { role: "employee", identifier: "emp-1", password: "employee-password-reset-123" },
  });
  assert.equal(login.status, 200);
  const employeeSession = await request("/api/session");
  csrfToken = employeeSession.body.csrfToken;
  assert.equal((await request(`/api/employees/${create.body.employee.id}/password`, {
    method: "PATCH",
    body: { password: "employee-password-other-123" },
  })).status, 403);

  assert.equal((await request("/api/attendance", { method: "POST", body: { type: "check-out" } })).status, 409);
  const checkIn = await request("/api/attendance", {
    method: "POST",
    body: { type: "check-in", reason: "Traffic delay" },
  });
  assert.equal(checkIn.status, 201);
  assert.equal(checkIn.body.event.reason, "Traffic delay");
  assert.equal((await request("/api/attendance", { method: "POST", body: { type: "check-in" } })).status, 409);
  assert.equal((await request("/api/attendance", { method: "POST", body: { type: "check-out" } })).status, 201);
  const history = await request("/api/attendance");
  assert.deepEqual(history.body.events.map((event) => event.type), ["check-out", "check-in"]);
  assert.equal(history.body.events[1].reason, "Traffic delay");
  assert.equal((await request("/api/attendance?lateCheckIns=true")).status, 403);

  const leave = await request("/api/leaves", {
    method: "POST",
    body: { type: "Casual", startDate: "2026-11-25", endDate: "2026-11-26", reason: "Family appointment" },
  });
  assert.equal(leave.status, 201);
  assert.equal((await request("/api/leaves")).body.leaves.length, 1);

  await request("/api/logout", { method: "POST", body: {} });
  const loggedOut = await request("/api/session");
  csrfToken = loggedOut.body.csrfToken;
  const recovered = await request("/api/admin/recover", {
    method: "POST",
    body: { username: "admin", recoveryCode: adminRecoveryCode, password: "recovered-admin-password-123" },
  });
  assert.equal(recovered.status, 200);
  const finalAdminSession = await request("/api/session");
  csrfToken = finalAdminSession.body.csrfToken;
  assert.equal(finalAdminSession.body.user.role, "admin");
  assert.equal((await request("/api/admin/recover", {
    method: "POST",
    body: { username: "admin", recoveryCode: adminRecoveryCode, password: "another-admin-password-123" },
  })).status, 401);

  await request("/api/logout", { method: "POST", body: {} });
  const finalSession = await request("/api/session");
  csrfToken = finalSession.body.csrfToken;
  assert.equal((await request("/api/login", {
    method: "POST",
    body: { role: "admin", identifier: "admin", password: "admin-password-123" },
  })).status, 401);
  assert.equal((await request("/api/login", {
    method: "POST",
    body: { role: "admin", identifier: "admin", password: "recovered-admin-password-123" },
  })).status, 200);
  const adminSession = await request("/api/session");
  csrfToken = adminSession.body.csrfToken;
  const lateCheckIns = await request("/api/attendance?lateCheckIns=true");
  assert.equal(lateCheckIns.status, 200);
  assert.equal(lateCheckIns.body.events.length, 1);
  assert.equal(lateCheckIns.body.events[0].reason, "Traffic delay");
  assert.equal(lateCheckIns.body.events[0].employeeName, "Riley Employee");
  assert.equal((await request(`/api/leaves/${leave.body.leave.id}/status`, {
    method: "PATCH",
    body: { status: "approved" },
  })).status, 200);
  const report = await request("/api/reports/monthly");
  assert.equal(report.status, 200);
  const employeeReport = report.body.report.find((item) => item.employeeCode === "EMP-1");
  assert.equal(employeeReport.approvedLeaveDays, 2);
  assert.equal(employeeReport.leaves[0].status, "approved");

  await request("/api/logout", { method: "POST", body: {} });
  csrfToken = (await request("/api/session")).body.csrfToken;
  assert.equal((await request("/api/login", {
    method: "POST",
    body: { role: "employee", identifier: "EMP-1", password: "employee-password-reset-123" },
  })).status, 200);
  csrfToken = (await request("/api/session")).body.csrfToken;
  const cancelled = await request(`/api/leaves/${leave.body.leave.id}`, { method: "DELETE" });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.body.leave.status, "cancelled");
  assert.equal(typeof cancelled.body.leave.cancelledAt, "string");
  assert.equal((await request("/api/leaves")).body.leaves[0].status, "cancelled");

  const duplicateCancellation = await request(`/api/leaves/${leave.body.leave.id}`, { method: "DELETE" });
  assert.equal(duplicateCancellation.status, 409);
  assert.equal((await request(`/api/leaves/${leave.body.leave.id}/cancel`, { method: "PATCH" })).status, 409);

  await request("/api/logout", { method: "POST", body: {} });
  csrfToken = (await request("/api/session")).body.csrfToken;
  assert.equal((await request("/api/login", {
    method: "POST",
    body: { role: "admin", identifier: "admin", password: "recovered-admin-password-123" },
  })).status, 200);
  csrfToken = (await request("/api/session")).body.csrfToken;
  const removed = await request(`/api/employees/${create.body.employee.id}`, { method: "DELETE" });
  assert.equal(removed.status, 200);
  assert.equal(removed.body.employee.employeeId, "EMP-1");
  assert.equal((await request("/api/employees")).body.employees.length, 0);
  assert.equal((await request("/api/leaves")).body.leaves.length, 0);
  assert.equal((await request("/api/attendance")).body.events.length, 0);
});

test("database mode keeps app data and sessions across server instances", async () => {
  const state = {
    payload: { admins: [], employees: [], attendance: [], leaves: [] },
    sessions: new Map(),
  };
  const database = {
    async connect() {
      return {
        async query(query, parameters = []) {
          const sql = query.replace(/\s+/g, " ").trim();
          if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
          if (sql.startsWith("SELECT payload FROM attendance_app_state")) {
            return { rows: [{ payload: JSON.parse(JSON.stringify(state.payload)) }] };
          }
          if (sql.startsWith("UPDATE attendance_app_state")) {
            state.payload = JSON.parse(parameters[0]);
            return { rowCount: 1, rows: [] };
          }
          if (sql.startsWith("SELECT csrf_token, user_role, user_id, user_name, expires_at")) {
            const session = state.sessions.get(parameters[0]);
            return { rows: session && session.expires_at > new Date()
              ? [{
                  csrf_token: session.csrf_token,
                  user_role: session.user_role,
                  user_id: session.user_id,
                  user_name: session.user_name,
                  expires_at: session.expires_at,
                }]
              : [] };
          }
          if (sql.startsWith("INSERT INTO attendance_sessions")) {
            state.sessions.set(parameters[0], {
              csrf_token: parameters[1],
              user_role: parameters[2],
              user_id: parameters[3],
              user_name: parameters[4],
              expires_at: parameters[5],
            });
            return { rows: [] };
          }
          if (sql.startsWith("DELETE FROM attendance_sessions WHERE session_id_hash")) {
            state.sessions.delete(parameters[0]);
            return { rows: [] };
          }
          if (sql.startsWith("DELETE FROM attendance_sessions WHERE user_role")) {
            for (const [sessionId, session] of state.sessions) {
              if (session.user_role === "employee" && session.user_id === parameters[0]) state.sessions.delete(sessionId);
            }
            return { rows: [] };
          }
          throw new Error(`Unexpected mock query: ${sql}`);
        },
        release() {},
      };
    },
  };

  let databaseServer;
  let databaseUrl;
  let cookie;
  let token;
  async function startServer() {
    databaseServer = createAppServer({ database });
    await new Promise((resolve) => databaseServer.listen(0, "127.0.0.1", resolve));
    databaseUrl = `http://127.0.0.1:${databaseServer.address().port}`;
  }
  async function closeServer() {
    await new Promise((resolve) => databaseServer.close(resolve));
    databaseServer = null;
  }
  async function call(route, { method = "GET", body } = {}) {
    return new Promise((resolve, reject) => {
      const headers = {};
      if (cookie) headers.Cookie = cookie;
      if (body !== undefined) headers["Content-Type"] = "application/json";
      if (token) headers["X-CSRF-Token"] = token;
      const req = http.request(`${databaseUrl}${route}`, { method, headers }, (res) => {
        let responseBody = "";
        res.on("data", (chunk) => { responseBody += chunk; });
        res.on("end", () => {
          if (res.headers["set-cookie"]) cookie = res.headers["set-cookie"][0].split(";")[0];
          resolve({ status: res.statusCode, body: responseBody ? JSON.parse(responseBody) : null });
        });
      });
      req.on("error", reject);
      if (body !== undefined) req.write(JSON.stringify(body));
      req.end();
    });
  }

  try {
    await startServer();
    const firstSession = await call("/api/session");
    token = firstSession.body.csrfToken;
    const setup = await call("/api/setup", {
      method: "POST",
      body: { username: "db-admin", password: "db-admin-password-123" },
    });
    assert.equal(setup.status, 201);
    assert.equal(state.payload.admins.length, 1);
    assert.equal(state.sessions.size, 1);
    token = (await call("/api/session")).body.csrfToken;
    const authenticatedCookie = cookie;

    await closeServer();
    await startServer();
    const persistedSession = await call("/api/session");
    assert.equal(persistedSession.body.firstRun, false);
    assert.equal(persistedSession.body.user.role, "admin");

    const logout = await call("/api/logout", { method: "POST", body: {} });
    assert.equal(logout.status, 200);
    assert.equal(state.sessions.size, 1);
    cookie = authenticatedCookie;
    const revokedSession = await call("/api/session");
    assert.equal(revokedSession.body.user, null);
  } finally {
    if (databaseServer) await closeServer();
  }
});

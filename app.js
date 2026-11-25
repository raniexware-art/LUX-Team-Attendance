 const authView = document.querySelector("#auth-view");
const appView = document.querySelector("#app-view");
const authFormContainer = document.querySelector("#auth-form-container");
const dashboardContent = document.querySelector("#dashboard-content");
const toast = document.querySelector("#toast");
const attendanceNotification = document.querySelector("#attendance-notification");
const lateCheckInDialog = document.querySelector("#late-checkin-dialog");
let csrfToken = "";
let currentUser = null;
let selectedRole = "employee";
let toastTimer;
let attendanceNotificationTimer;
let employeeReminderTimer = null;
let employeeClockTimer = null;
let employeeReminderListenersInstalled = false;
let adminMonthlyReport = null;
let employeeIsCheckedIn = false;
let employeeHasCheckedInToday = false;
const sentEmployeeReminders = new Map();
const shownLateCheckInPrompts = new Set();
const EMPLOYEE_REMINDER_TIMES = { morning: "10:16", evening: "18:00" };
const EMPLOYEE_CHECK_IN_REMINDER_INTERVAL_MS = 60 * 1000;
const EMPLOYEE_CHECK_IN_REMINDER_DURATION_MS = 60 * 60 * 1000;
const EMPLOYEE_SCHEDULED_CHECK_IN = "10:10";
const EMPLOYEE_LATE_CHECK_IN_DELAY_MS = 30 * 60 * 1000;
const EMPLOYEE_ID_STORAGE_KEY = "team-attendance.employee-id";
const REMEMBER_EMPLOYEE_ID_STORAGE_KEY = "team-attendance.remember-employee-id";

async function api(url, options = {}) {
  const headers = { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) };
  if (options.method && options.method !== "GET") headers["X-CSRF-Token"] = csrfToken;
  const response = await fetch(url, { ...options, headers });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Something went wrong.");
  return result;
}

function setupPasswordVisibility() {
  document.querySelectorAll('input[type="password"]:not([data-password-toggle-ready])').forEach((input) => {
    input.dataset.passwordToggleReady = "true";
    const wrapper = document.createElement("div");
    wrapper.className = "password-field";
    input.before(wrapper);
    wrapper.append(input);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "password-toggle";
    button.setAttribute("aria-label", "Show password");
    button.textContent = "Show";
    button.addEventListener("click", () => {
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      button.textContent = show ? "Hide" : "Show";
      button.setAttribute("aria-label", show ? "Hide password" : "Show password");
      input.focus();
    });
    wrapper.append(button);
  });
}

function showToast(message, isError = false, duration = 3600) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.remove("hidden");
  toastTimer = setTimeout(() => toast.classList.add("hidden"), duration);
}

function showAttendanceNotification(type) {
  const isCheckIn = type === "check-in";
  clearTimeout(attendanceNotificationTimer);
  document.querySelector("#attendance-reminder-action").classList.add("hidden");
  document.querySelector("#attendance-notification-title").textContent = isCheckIn ? "Check-in successful" : "Check-out successful";
  document.querySelector("#attendance-notification-message").textContent = isCheckIn
    ? "You're checked in. Have a great day!"
    : "You're checked out. See you next time!";
  document.querySelector("#attendance-notification-time").textContent = formatClockTime(new Date());
  attendanceNotification.classList.toggle("is-check-out", !isCheckIn);
  attendanceNotification.classList.remove("is-reminder");
  attendanceNotification.classList.remove("hidden");
  attendanceNotificationTimer = setTimeout(() => attendanceNotification.classList.add("hidden"), 7000);
}

function showBrowserAttendanceNotification(type) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const isCheckIn = type === "check-in";
  try {
    new Notification(isCheckIn ? "Check-in successful" : "Check-out successful", {
      body: isCheckIn ? "You're checked in. Have a great day!" : "You're checked out. See you next time!",
      tag: `attendance-${type}-${Date.now()}`,
    });
  } catch (error) {
    showToast(error.message || "Unable to show a browser notification.", true);
  }
}

function showCheckInReminderNotification() {
  clearTimeout(attendanceNotificationTimer);
  document.querySelector("#attendance-notification-title").textContent = "Check-in reminder";
  document.querySelector("#attendance-notification-message").textContent = "You're currently checked out. Check in now.";
  document.querySelector("#attendance-notification-time").textContent = formatClockTime(new Date());
  attendanceNotification.classList.remove("is-check-out");
  attendanceNotification.classList.add("is-reminder");
  document.querySelector("#attendance-reminder-action").textContent = "Check in now";
  document.querySelector("#attendance-reminder-action").classList.remove("hidden");
  attendanceNotification.classList.remove("hidden");
}

function showCheckOutReminderNotification() {
  clearTimeout(attendanceNotificationTimer);
  document.querySelector("#attendance-notification-title").textContent = "Check-out reminder";
  document.querySelector("#attendance-notification-message").textContent = "You're still checked in. Check out to finish your workday.";
  document.querySelector("#attendance-notification-time").textContent = formatClockTime(new Date());
  attendanceNotification.classList.remove("is-reminder");
  attendanceNotification.classList.add("is-check-out");
  document.querySelector("#attendance-reminder-action").textContent = "Check out now";
  document.querySelector("#attendance-reminder-action").classList.remove("hidden");
  attendanceNotification.classList.remove("hidden");
}

document.querySelector("#attendance-reminder-action").addEventListener("click", () => {
  attendanceNotification.classList.add("hidden");
  toggleAttendance();
});

document.querySelector("#attendance-notification-close").addEventListener("click", () => {
  clearTimeout(attendanceNotificationTimer);
  attendanceNotification.classList.add("hidden");
});

function renderLogin(firstRun) {
  authView.classList.remove("hidden");
  appView.classList.add("hidden");
  if (firstRun) {
    authFormContainer.innerHTML = `
      <div class="auth-card">
        <span class="eyebrow">GET STARTED</span>
        <h2>Create your admin account</h2>
        <p class="auth-description">Set up the administrator account for this attendance app. You can add employee accounts after signing in.</p>
        <form id="setup-form">
          <div class="field"><label for="setup-username">Admin username</label><input id="setup-username" name="username" required minlength="3" maxlength="40" autocomplete="username" placeholder="Choose a username"></div>
          <div class="field"><label for="setup-password">Password</label><input id="setup-password" name="password" type="password" required minlength="10" maxlength="128" autocomplete="new-password" placeholder="At least 10 characters"></div>
          <button class="button button-primary" type="submit">Create admin account</button>
          <p class="form-error" id="form-error" role="alert"></p>
        </form>
        <p class="secure-note">Passwords are stored as secure hashes, never as plain text.</p>
      </div>`;
    document.querySelector("#setup-form").addEventListener("submit", setupAdmin);
    setupPasswordVisibility();
    return;
  }

  selectedRole = "employee";
  authFormContainer.innerHTML = `
    <div class="auth-card">
      <span class="eyebrow">WELCOME BACK</span>
      <h2>Sign in to your account</h2>
      <p class="auth-description">Choose your account type, then enter your sign-in details.</p>
      <div class="role-tabs" role="tablist" aria-label="Account type">
        <button class="role-tab active" id="employee-tab" type="button" role="tab" aria-selected="true">Employee</button>
        <button class="role-tab" id="admin-tab" type="button" role="tab" aria-selected="false">Admin</button>
      </div>
      <form id="login-form">
        <div class="field"><label id="identifier-label" for="login-identifier">Employee ID</label><input id="login-identifier" name="identifier" required autocomplete="username" placeholder="Enter your employee ID"></div>
        <div class="field"><label for="login-password">Password</label><input id="login-password" name="password" type="password" required autocomplete="current-password" placeholder="Enter your password"></div>
        <div class="remember-row" id="remember-employee-row"><input id="remember-employee-id" type="checkbox"><label for="remember-employee-id">Remember employee ID on this device</label></div>
        <button class="text-button" id="forgot-password" type="button">Forgot password?</button>
        <button class="button button-primary" type="submit">Sign in</button>
        <p class="form-error" id="form-error" role="alert"></p>
      </form>
      <p class="secure-note">Need an account? Ask your administrator.</p>
    </div>`;

  document.querySelector("#employee-tab").addEventListener("click", () => setRole("employee"));
  document.querySelector("#admin-tab").addEventListener("click", () => setRole("admin"));
  document.querySelector("#login-form").addEventListener("submit", login);
  document.querySelector("#forgot-password").addEventListener("click", renderForgotPassword);
  const employeeIdPreference = readEmployeeIdPreference();
  document.querySelector("#remember-employee-id").checked = employeeIdPreference.remember;
  document.querySelector("#login-identifier").value = employeeIdPreference.remember ? employeeIdPreference.employeeId : "";
  document.querySelector("#remember-employee-id").addEventListener("change", (event) => {
    updateEmployeeIdPreference(event.currentTarget.checked);
  });
  setupPasswordVisibility();
}

function setRole(role) {
  selectedRole = role;
  for (const [tabRole, id] of [["employee", "employee-tab"], ["admin", "admin-tab"]]) {
    const active = role === tabRole;
    document.querySelector(`#${id}`).classList.toggle("active", active);
    document.querySelector(`#${id}`).setAttribute("aria-selected", String(active));
  }
  document.querySelector("#identifier-label").textContent = role === "admin" ? "Admin username" : "Employee ID";
  document.querySelector("#login-identifier").placeholder = role === "admin" ? "Enter your admin username" : "Enter your employee ID";
  const employeeIdPreference = readEmployeeIdPreference();
  document.querySelector("#remember-employee-row").classList.toggle("hidden", role !== "employee");
  document.querySelector("#remember-employee-id").checked = employeeIdPreference.remember;
  document.querySelector("#login-identifier").value = role === "employee" && employeeIdPreference.remember ? employeeIdPreference.employeeId : "";
  document.querySelector("#login-password").value = "";
}

function readEmployeeIdPreference() {
  try {
    return {
      employeeId: localStorage.getItem(EMPLOYEE_ID_STORAGE_KEY) || "",
      remember: localStorage.getItem(REMEMBER_EMPLOYEE_ID_STORAGE_KEY) !== "false",
    };
  } catch (error) {
    showToast(error.message || "Unable to read the saved employee ID.", true);
    return { employeeId: "", remember: true };
  }
}

function updateEmployeeIdPreference(remember) {
  try {
    localStorage.setItem(REMEMBER_EMPLOYEE_ID_STORAGE_KEY, String(remember));
    if (!remember) localStorage.removeItem(EMPLOYEE_ID_STORAGE_KEY);
  } catch (error) {
    showToast(error.message || "Unable to update the employee ID preference.", true);
  }
}

function saveEmployeeId(identifier, remember) {
  try {
    localStorage.setItem(REMEMBER_EMPLOYEE_ID_STORAGE_KEY, String(remember));
    if (remember) localStorage.setItem(EMPLOYEE_ID_STORAGE_KEY, identifier.trim());
    else localStorage.removeItem(EMPLOYEE_ID_STORAGE_KEY);
  } catch (error) {
    showToast(error.message || "Unable to save the employee ID.", true);
  }
}

async function setupAdmin(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  setFormError("");
  try {
    await api("/api/setup", { method: "POST", body: JSON.stringify(Object.fromEntries(form)) });
    await loadSession();
  } catch (error) {
    setFormError(error.message);
  }
}

async function removeEmployee(employee) {
  if (!window.confirm(`Remove ${employee.name} (${employee.employeeId})? This will also remove their attendance and leave records.`)) return;
  try {
    await api(`/api/employees/${encodeURIComponent(employee.id)}`, { method: "DELETE" });
    showToast(`${employee.name} was removed.`);
    await renderAdmin("dashboard");
  } catch (error) {
    showToast(error.message || "Unable to remove employee.", true);
  }
}

async function login(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const data = Object.fromEntries(form);
  setFormError("");
  try {
    await api("/api/login", { method: "POST", body: JSON.stringify({ ...data, role: selectedRole }) });
    if (selectedRole === "employee") {
      saveEmployeeId(data.identifier, document.querySelector("#remember-employee-id").checked);
    }
    await loadSession();
  } catch (error) {
    setFormError(error.message);
  }
}

function renderForgotPassword() {
  authFormContainer.innerHTML = `
    <div class="auth-card">
      <span class="eyebrow">ACCOUNT RECOVERY</span>
      <h2>Reset your password</h2>
      <p class="auth-description">${selectedRole === "admin"
    ? "Enter the one-time recovery code you saved from the admin workspace."
    : "Ask your administrator to set a new password for your employee account."}</p>
      ${selectedRole === "admin" ? `
        <form id="recovery-form">
          <div class="field"><label for="recovery-username">Admin username</label><input id="recovery-username" name="username" required autocomplete="username"></div>
          <div class="field"><label for="recovery-code">Recovery code</label><input id="recovery-code" name="recoveryCode" required autocomplete="off"></div>
          <div class="field"><label for="recovery-password">New password</label><input id="recovery-password" name="password" type="password" required minlength="10" maxlength="128" autocomplete="new-password" placeholder="At least 10 characters"></div>
          <button class="button button-primary" type="submit">Reset admin password</button>
          <p class="form-error" id="form-error" role="alert"></p>
        </form>` : ""}
      <button class="text-button back-to-login" id="back-to-login" type="button">Back to sign in</button>
    </div>`;
  document.querySelector("#back-to-login").addEventListener("click", () => renderLogin(false));
  const form = document.querySelector("#recovery-form");
  if (form) form.addEventListener("submit", recoverAdmin);
  setupPasswordVisibility();
}

async function recoverAdmin(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  setFormError("");
  try {
    await api("/api/admin/recover", { method: "POST", body: JSON.stringify(Object.fromEntries(form)) });
    await loadSession();
  } catch (error) {
    setFormError(error.message);
  }
}

function setFormError(message) {
  const element = document.querySelector("#form-error");
  if (element) element.textContent = message;
}

async function loadSession() {
  const session = await api("/api/session");
  csrfToken = session.csrfToken;
  currentUser = session.user;
  if (!currentUser) {
    stopEmployeeReminders();
    stopEmployeeClock();
    return renderLogin(session.firstRun);
  }
  authView.classList.add("hidden");
  appView.classList.remove("hidden");
  appView.classList.toggle("employee-mode", currentUser.role === "employee");
  document.body.classList.toggle("employee-layout", currentUser.role === "employee");
  document.body.classList.toggle("admin-layout", currentUser.role === "admin");
  document.querySelector("#logout-button").onclick = logout;
  if (currentUser.role === "admin") {
    stopEmployeeReminders();
    stopEmployeeClock();
    await renderAdmin();
  } else {
    await renderEmployee();
  }
  setupPasswordVisibility();
}

async function logout() {
  try {
    await api("/api/logout", { method: "POST", body: "{}" });
    stopEmployeeReminders();
    stopEmployeeClock();
    await loadSession();
  } catch (error) {
    showToast(error.message, true);
  }
}

function setDashboardHeading(eyebrow, title, subtitle) {
  document.querySelector("#dashboard-eyebrow").textContent = eyebrow;
  document.querySelector("#dashboard-title").textContent = title;
  document.querySelector("#dashboard-subtitle").textContent = subtitle;
}

async function renderAdmin(initialPage = "dashboard") {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const [employeeResult, attendanceResult, leaveResult, reportResult, lateCheckInResult] = await Promise.all([
    api("/api/employees"),
    api("/api/attendance"),
    api("/api/leaves"),
    api(`/api/reports/monthly?month=${encodeURIComponent(currentMonth)}`),
    api("/api/attendance?lateCheckIns=true"),
  ]);
  const employees = employeeResult.employees;
  dashboardContent.innerHTML = `
    <div class="admin-layout-grid" id="admin-dashboard">
      <aside class="employee-sidebar admin-sidebar">
        <a class="employee-brand admin-brand admin-page-link" data-page="dashboard" data-section="dashboard" href="#admin-dashboard-page" aria-label="LUX & Decibels home"><img class="employee-brand-logo" src="/lux-decibels-logo.png" alt=""></a>
        <button class="mobile-menu-toggle" id="admin-menu-toggle" type="button" aria-controls="admin-nav" aria-expanded="false"><span aria-hidden="true">☰</span><span class="mobile-menu-label">Menu</span></button>
        <button class="mobile-dashboard-home admin-page-link" data-page="dashboard" data-section="dashboard" type="button">← Home</button>
        <nav class="employee-nav admin-nav mobile-nav-closed" id="admin-nav" aria-label="Admin navigation">
          <a class="employee-nav-link active admin-page-link" data-page="dashboard" data-section="dashboard" href="#admin-dashboard-page"><span>⌂</span>Home</a>
          <a class="employee-nav-link admin-page-link" data-page="leave" data-section="leave" href="#admin-leave-page"><span>▦</span>Leave Requests</a>
          <a class="employee-nav-link admin-page-link" data-page="reports" data-section="reports" href="#admin-reports-page"><span>▥</span>Monthly Report</a>
          <a class="employee-nav-link admin-page-link" data-page="employees" data-section="employees" href="#admin-employees-page"><span>＋</span>Add Employee</a>
          <a class="employee-nav-link admin-page-link" data-page="password" data-section="password" href="#admin-password-page"><span>⚿</span>Reset Password</a>
          <button class="admin-mobile-logout" id="admin-mobile-logout-button" type="button"><span aria-hidden="true">⇥</span>Sign out</button>
        </nav>
        <button class="employee-sidebar-logout" id="admin-logout-button" type="button"><span>⇥</span>Sign out</button>
        <span class="employee-sidebar-foot">© ${new Date().getFullYear()} LUX &amp; Decibels</span>
      </aside>
      <main class="admin-main">
        <header class="employee-welcome-header admin-welcome-header">
          <div><h1>Admin Workspace</h1><p>Welcome, ${escapeHtml(currentUser.name)}. Manage your team and attendance.</p></div>
          <span class="employee-profile" aria-label="Profile: ${escapeHtml(currentUser.name)}">${escapeHtml(currentUser.name.trim().slice(0, 1).toUpperCase())}</span>
        </header>
        <section class="admin-page ${initialPage === "dashboard" ? "" : "hidden"}" id="admin-dashboard-page">
          <div class="admin-panel-grid">
      <section class="panel admin-employee-directory-panel">
        <h2 class="panel-title">Employee directory <span class="count-label">${employees.length} ${employees.length === 1 ? "employee" : "employees"}</span></h2>
        <div class="table-wrap">
          <table><thead><tr><th>Employee</th><th>Employee ID</th><th>Today</th><th>Action</th></tr></thead><tbody id="employee-rows"></tbody></table>
        </div>
        ${employees.length ? "" : '<p class="empty-state">No employee accounts yet. Create the first one to get started.</p>'}
      </section>
      <section class="panel admin-recovery-panel">
        <h2 class="panel-title">Admin recovery</h2>
        <p class="panel-description">Generate a one-time code and save it somewhere private. A new code invalidates the previous one.</p>
        <button class="button button-quiet recovery-code-button" id="generate-recovery-code" type="button">Generate a new recovery code</button>
        <div class="recovery-code-box hidden" id="recovery-code-box">
          <span>Save this code now. It will only be shown once.</span>
          <code id="recovery-code-value"></code>
        </div>
      </section>
      <section class="panel">
        <h2 class="panel-title">Today's attendance</h2>
        <div class="admin-attendance-columns" id="admin-attendance"></div>
      </section>
          </div>
        </section>
        <section class="admin-page ${initialPage === "leave" ? "" : "hidden"}" id="admin-leave-page">
          <header class="employee-page-heading"><div><span class="employee-section-label">TEAM TIME OFF</span><h2>Leave Requests</h2><p>Review and respond to employee leave applications.</p></div></header>
          <section class="panel leave-admin-panel">
            <h2 class="panel-title">All requests <span class="count-label">${leaveResult.leaves.filter((leave) => leave.status === "pending").length} pending</span></h2>
            <div class="leave-request-list" id="leave-request-list"></div>
          </section>
          <section class="panel leave-admin-panel">
            <h2 class="panel-title">Late check-in reasons <span class="count-label">${lateCheckInResult.events.length} total</span></h2>
            <div class="leave-request-list" id="late-check-in-list"></div>
          </section>
        </section>
        <section class="admin-page ${initialPage === "reports" ? "" : "hidden"}" id="admin-reports-page">
          <header class="employee-page-heading"><div><span class="employee-section-label">TEAM RECORDS</span><h2>Monthly Report</h2><p>Review employee attendance and leave details by month.</p></div></header>
          <section class="panel monthly-report-panel">
            <div class="report-heading">
              <h2 class="panel-title">Attendance Calendar</h2>
              <div class="report-controls"><label for="monthly-report-employee">Employee</label><select class="report-employee-select" id="monthly-report-employee" aria-label="Select employee"></select></div>
            </div>
            <div id="monthly-report-content"></div>
          </section>
        </section>
        <section class="admin-page ${initialPage === "employees" ? "" : "hidden"}" id="admin-employees-page">
          <header class="employee-page-heading"><div><span class="employee-section-label">TEAM MANAGEMENT</span><h2>Add Employee</h2><p>Create an employee account with a secure temporary password.</p></div></header>
          <section class="panel admin-form-panel">
        <h2 class="panel-title">Add an employee</h2>
        <form id="employee-form">
          <div class="field"><label for="employee-name">Full name</label><input id="employee-name" name="name" required maxlength="80" placeholder="e.g. Alex Morgan"></div>
          <div class="field"><label for="employee-id">Employee ID</label><input id="employee-id" name="employeeId" required maxlength="40" placeholder="e.g. EMP-104"></div>
          <div class="field"><label for="employee-password">Temporary password</label><input id="employee-password" name="password" type="password" required minlength="10" maxlength="128" autocomplete="new-password" placeholder="At least 10 characters"></div>
          <button class="button button-primary" type="submit">Create employee account</button>
          <p class="form-error" id="form-error" role="alert"></p>
        </form>
      </section>
        </section>
        <section class="admin-page ${initialPage === "password" ? "" : "hidden"}" id="admin-password-page">
          <header class="employee-page-heading"><div><span class="employee-section-label">ACCOUNT SECURITY</span><h2>Reset Employee Password</h2><p>Set a new password for an employee account.</p></div></header>
          <section class="panel admin-form-panel">
        <h2 class="panel-title">Reset an employee password</h2>
        ${employees.length ? `
          <form id="reset-employee-form">
            <div class="field"><label for="reset-employee-id">Employee</label><select id="reset-employee-id" name="employeeId" required></select></div>
            <div class="field"><label for="reset-employee-password">New password</label><input id="reset-employee-password" name="password" type="password" required minlength="10" maxlength="128" autocomplete="new-password" placeholder="At least 10 characters"></div>
            <button class="button button-primary" type="submit">Set new password</button>
            <p class="form-error" id="reset-form-error" role="alert"></p>
          </form>` : '<p class="empty-state">Create an employee account before resetting a password.</p>'}
      </section>
        </section>
      </main>
    </div>`;

  const rows = document.querySelector("#employee-rows");
  for (const employee of employees) {
    const row = document.createElement("tr");
    row.innerHTML = `<td><span class="person"><span class="avatar"></span><span class="person-name"></span></span></td><td class="employee-code"></td><td><span class="status"></span></td><td><button type="button" class="remove-employee-button">Remove</button></td>`;
    row.querySelector(".avatar").textContent = employee.name.slice(0, 1).toUpperCase();
    row.querySelector(".person-name").textContent = employee.name;
    row.querySelector(".employee-code").textContent = employee.employeeId;
    const status = row.querySelector(".status");
    status.textContent = employee.checkedIn ? "Checked in" : "Checked out";
    status.classList.toggle("online", employee.checkedIn);
    row.querySelector(".remove-employee-button").addEventListener("click", () => removeEmployee(employee));
    rows.append(row);
  }
  renderAdminAttendance(document.querySelector("#admin-attendance"), attendanceResult.events);
  document.querySelector("#employee-form").addEventListener("submit", createEmployee);
  const resetEmployeeForm = document.querySelector("#reset-employee-form");
  if (resetEmployeeForm) {
    const select = document.querySelector("#reset-employee-id");
    for (const employee of employees) {
      const option = document.createElement("option");
      option.value = employee.id;
      option.textContent = `${employee.name} (${employee.employeeId})`;
      select.append(option);
    }
    resetEmployeeForm.addEventListener("submit", resetEmployeePassword);
  }
  document.querySelector("#generate-recovery-code").addEventListener("click", generateRecoveryCode);
  renderLeaveRequests(leaveResult.leaves);
  renderLateCheckInReasons(lateCheckInResult.events);
  renderMonthlyReport(reportResult);
  document.querySelector("#monthly-report-employee").addEventListener("change", () => renderMonthlyReport(adminMonthlyReport));
  document.querySelector("#admin-logout-button").addEventListener("click", logout);
  document.querySelector("#admin-mobile-logout-button").addEventListener("click", logout);
  setupAdminNavigation(initialPage);
}

function setupAdminNavigation(initialPage) {
  const pages = {
    dashboard: document.querySelector("#admin-dashboard-page"),
    leave: document.querySelector("#admin-leave-page"),
    reports: document.querySelector("#admin-reports-page"),
    employees: document.querySelector("#admin-employees-page"),
    password: document.querySelector("#admin-password-page"),
  };
  const navLinks = document.querySelectorAll(".admin-nav .employee-nav-link");
  navLinks.forEach((link) => link.classList.toggle("active", link.dataset.section === initialPage));
  setMobileMenuVisibility("admin-menu-toggle", "admin-nav", initialPage === "dashboard");
  document.querySelectorAll(".admin-page-link").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const page = pages[link.dataset.page];
      if (!page) return;
      Object.values(pages).forEach((item) => item.classList.add("hidden"));
      page.classList.remove("hidden");
      const section = link.dataset.section || link.dataset.page;
      navLinks.forEach((item) => item.classList.toggle("active", item.dataset.section === section));
      setMobileMenuVisibility("admin-menu-toggle", "admin-nav", link.dataset.page === "dashboard");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });
  setupMobileMenu("admin-menu-toggle", "admin-nav");
}

async function createEmployee(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  setFormError("");
  try {
    await api("/api/employees", { method: "POST", body: JSON.stringify(data) });
    showToast(`Account created for ${data.name}. Share the employee ID and password with them securely.`);
    await renderAdmin("employees");
  } catch (error) {
    setFormError(error.message);
  }
}

async function resetEmployeePassword(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const employeeId = form.get("employeeId");
  const password = form.get("password");
  const error = document.querySelector("#reset-form-error");
  error.textContent = "";
  try {
    await api(`/api/employees/${encodeURIComponent(employeeId)}/password`, {
      method: "PATCH",
      body: JSON.stringify({ password }),
    });
    showToast("Employee password updated. Share the new password securely.");
    event.currentTarget.reset();
  } catch (requestError) {
    error.textContent = requestError.message;
  }
}

async function generateRecoveryCode(event) {
  const button = event.currentTarget;
  button.disabled = true;
  const codeBox = document.querySelector("#recovery-code-box");
  codeBox.classList.add("hidden");
  try {
    const result = await api("/api/admin/recovery-code", { method: "POST", body: "{}" });
    document.querySelector("#recovery-code-value").textContent = result.recoveryCode;
    codeBox.classList.remove("hidden");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

function renderLeaveRequests(leaves) {
  const container = document.querySelector("#leave-request-list");
  if (!container) return;
  if (!leaves.length) {
    container.innerHTML = '<p class="empty-state">No leave requests yet.</p>';
    return;
  }
  container.innerHTML = "";
  for (const leave of leaves) {
    const card = document.createElement("article");
    card.className = "leave-request";
    card.innerHTML = `
      <div class="leave-request-heading">
        <div><strong class="leave-employee"></strong><span class="leave-code"></span></div>
        <span class="leave-status"></span>
      </div>
      <div class="leave-meta"></div>
      <p class="leave-reason"></p>
      <div class="leave-actions"></div>`;
    card.querySelector(".leave-employee").textContent = leave.employeeName;
    card.querySelector(".leave-code").textContent = leave.employeeCode;
    card.querySelector(".leave-status").textContent = leave.status;
    card.querySelector(".leave-status").classList.add(`status-${leave.status}`);
    card.querySelector(".leave-meta").textContent = `${leave.type} · ${formatDate(leave.startDate)} – ${formatDate(leave.endDate)} (${leaveDays(leave.startDate, leave.endDate)} ${leaveDays(leave.startDate, leave.endDate) === 1 ? "day" : "days"})`;
    card.querySelector(".leave-reason").textContent = leave.reason;
    if (leave.status === "pending") {
      const actions = card.querySelector(".leave-actions");
      for (const status of ["approved", "rejected"]) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `leave-action leave-action-${status}`;
        button.textContent = status === "approved" ? "Approve" : "Reject";
        button.addEventListener("click", () => reviewLeave(leave.id, status));
        actions.append(button);
      }
    }
    container.append(card);
  }
}

function renderLateCheckInReasons(events) {
  const container = document.querySelector("#late-check-in-list");
  if (!container) return;
  if (!events.length) {
    container.innerHTML = '<p class="empty-state">No late check-in reasons yet.</p>';
    return;
  }
  container.innerHTML = "";
  for (const event of events) {
    const card = document.createElement("article");
    card.className = "leave-request";
    card.innerHTML = `
      <div class="leave-request-heading">
        <div><strong class="late-check-in-employee"></strong><span class="leave-code"></span></div>
        <span class="leave-meta late-check-in-date"></span>
      </div>
      <p class="leave-reason"></p>`;
    card.querySelector(".late-check-in-employee").textContent = event.employeeName;
    card.querySelector(".leave-code").textContent = event.employeeCode;
    card.querySelector(".late-check-in-date").textContent = new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(event.at));
    card.querySelector(".leave-reason").textContent = event.reason;
    container.append(card);
  }
}

async function reviewLeave(leaveId, status) {
  try {
    await api(`/api/leaves/${encodeURIComponent(leaveId)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    showToast(status === "approved" ? "Leave request approved." : "Leave request rejected.");
    await renderAdmin("leave");
  } catch (error) {
    showToast(error.message, true);
  }
}

async function loadMonthlyReport(month) {
  if (!month) return;
  try {
    renderMonthlyReport(await api(`/api/reports/monthly?month=${encodeURIComponent(month)}`));
  } catch (error) {
    showToast(error.message, true);
  }
}

function renderMonthlyReport(result) {
  const select = document.querySelector("#monthly-report-employee");
  const content = document.querySelector("#monthly-report-content");
  if (!select || !content) return;
  adminMonthlyReport = result;
  const previousEmployeeId = select.value;
  select.replaceChildren();
  for (const record of result.report) {
    const option = document.createElement("option");
    option.value = record.employeeId;
    option.textContent = `${record.employeeName} (${record.employeeCode})`;
    select.append(option);
  }
  if (!result.report.length) {
    content.innerHTML = '<p class="empty-state">No employees found.</p>';
    return;
  }
  select.value = result.report.some((record) => record.employeeId === previousEmployeeId)
    ? previousEmployeeId
    : result.report[0].employeeId;
  const record = result.report.find((item) => item.employeeId === select.value);
  renderCalendarReport(content, record, result.month, loadMonthlyReport);
}

function renderCalendarReport(container, record, month, onMonthChange) {
  const [year, monthNumber] = month.split("-").map(Number);
  const monthIndex = monthNumber - 1;
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const monthStart = `${month}-01`;
  const monthEnd = `${month}-${String(daysInMonth).padStart(2, "0")}`;
  const presentDates = new Set((record.attendance || [])
    .filter((event) => event.type === "check-in")
    .map((event) => event.at.slice(0, 10)));
  const leaveDates = approvedLeaveDates(record.leaves || [], monthStart, monthEnd);
  const today = localDateKey(new Date());
  const days = [];
  let absentDays = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    const weekday = new Date(Date.UTC(year, monthIndex, day)).getUTCDay();
    let status = "";
    if (presentDates.has(date)) status = "present";
    else if (leaveDates.has(date)) status = "leave";
    else if (weekday !== 0 && weekday !== 6 && date < today) {
      status = "absent";
      absentDays += 1;
    }
    days.push({ date, day, status });
  }

  container.innerHTML = `
    <div class="attendance-calendar">
      <header class="calendar-toolbar">
        <h3><span aria-hidden="true">▦</span><span class="calendar-month-title"></span></h3>
        <div class="calendar-month-controls">
          <button type="button" class="calendar-month-button" data-month-shift="-1" aria-label="Previous month">‹</button>
          <button type="button" class="calendar-month-button" data-month-shift="1" aria-label="Next month">›</button>
        </div>
      </header>
      <div class="calendar-weekdays" aria-hidden="true"></div>
      <div class="calendar-days" role="grid" aria-label="Monthly attendance calendar"></div>
    </div>
    <div class="report-footer">
      <section class="report-details-card">
        <h3><span aria-hidden="true">▤</span>Report Details</h3>
        <div class="report-stat-grid">
          <div><span>Total Days</span><strong class="report-total-days"></strong></div>
          <div><span>Leave Days</span><strong class="report-leave-days"></strong></div>
          <div><span>Present Days</span><strong class="report-present-days"></strong></div>
          <div><span>Absent Days</span><strong class="report-absent-days"></strong></div>
          <div class="report-working-time"><span>Working Time</span><strong class="report-working-hours"></strong></div>
        </div>
        <p class="report-absence-note">Absent counts completed weekdays without attendance or approved leave.</p>
      </section>
      <section class="report-actions-card">
        <div class="report-legend">
          <span><i class="legend-present"></i>Present</span>
          <span><i class="legend-leave"></i>Leave</span>
          <span><i class="legend-absent"></i>Absent</span>
        </div>
        <button class="button button-primary report-download-button" type="button"><span aria-hidden="true">⇩</span>Download Report</button>
      </section>
    </div>`;

  container.querySelector(".calendar-month-title").textContent = new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, monthIndex, 1)));
  container.querySelector(".report-total-days").textContent = String(daysInMonth);
  container.querySelector(".report-leave-days").textContent = String(leaveDates.size);
  container.querySelector(".report-present-days").textContent = String(presentDates.size);
  container.querySelector(".report-absent-days").textContent = String(absentDays);
  container.querySelector(".report-working-hours").textContent = formatDuration(record.workingMs);

  const weekdays = container.querySelector(".calendar-weekdays");
  for (const weekday of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) {
    const heading = document.createElement("span");
    heading.textContent = weekday;
    weekdays.append(heading);
  }
  const calendarDays = container.querySelector(".calendar-days");
  const offset = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
  for (let cell = 0; cell < offset; cell++) {
    const empty = document.createElement("div");
    empty.className = "calendar-day calendar-day-empty";
    empty.setAttribute("role", "gridcell");
    calendarDays.append(empty);
  }
  for (const item of days) {
    const cell = document.createElement("div");
    cell.className = `calendar-day${item.status ? ` calendar-day-${item.status}` : ""}`;
    cell.setAttribute("role", "gridcell");
    const dayNumber = document.createElement("span");
    dayNumber.className = "calendar-day-number";
    dayNumber.textContent = String(item.day);
    cell.append(dayNumber);
    if (item.status) {
      const badge = document.createElement("span");
      badge.className = `calendar-day-badge badge-${item.status}`;
      badge.textContent = item.status.charAt(0).toUpperCase() + item.status.slice(1);
      cell.append(badge);
    }
    calendarDays.append(cell);
  }
  const totalCells = Math.max(35, Math.ceil((offset + daysInMonth) / 7) * 7);
  for (let cell = offset + daysInMonth; cell < totalCells; cell++) {
    const empty = document.createElement("div");
    empty.className = "calendar-day calendar-day-empty";
    empty.setAttribute("role", "gridcell");
    calendarDays.append(empty);
  }
  container.querySelectorAll("[data-month-shift]").forEach((button) => {
    button.addEventListener("click", () => onMonthChange(shiftMonth(month, Number(button.dataset.monthShift))));
  });
  container.querySelector(".report-download-button").addEventListener("click", () => {
    downloadMonthlyReport(record, month, days, {
      totalDays: daysInMonth,
      presentDays: presentDates.size,
      leaveDays: leaveDates.size,
      absentDays,
    });
  });
}

function approvedLeaveDates(leaves, monthStart, monthEnd) {
  const dates = new Set();
  for (const leave of leaves) {
    if (leave.status !== "approved" || leave.startDate > monthEnd || leave.endDate < monthStart) continue;
    let date = leave.startDate < monthStart ? monthStart : leave.startDate;
    const lastDate = leave.endDate > monthEnd ? monthEnd : leave.endDate;
    while (date <= lastDate) {
      dates.add(date);
      const next = new Date(`${date}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      date = next.toISOString().slice(0, 10);
    }
  }
  return dates;
}

function shiftMonth(month, offset) {
  const [year, monthNumber] = month.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function downloadMonthlyReport(record, month, days, summary) {
  const rows = [
    ["Monthly Attendance Report"],
    ["Employee", record.employeeName],
    ["Employee ID", record.employeeCode],
    ["Month", month],
    ["Total Days", summary.totalDays],
    ["Present Days", summary.presentDays],
    ["Leave Days", summary.leaveDays],
    ["Absent Days", summary.absentDays],
    ["Working Time", formatDuration(record.workingMs)],
    [],
    ["Date", "Day", "Status"],
    ...days.map((item) => [item.date, new Intl.DateTimeFormat(undefined, { weekday: "long", timeZone: "UTC" }).format(new Date(`${item.date}T00:00:00Z`)), item.status || "—"]),
  ];
  const csv = rows.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${record.employeeCode}-${month}-report.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function renderEmployee() {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const [result, leaveResult, reportResult] = await Promise.all([
    api("/api/attendance"),
    api("/api/leaves"),
    api(`/api/reports/monthly?month=${encodeURIComponent(currentMonth)}`),
  ]);
  employeeIsCheckedIn = result.events[0]?.type === "check-in";
  const summary = summarizeToday(result.events);
  employeeHasCheckedInToday = Boolean(summary.firstCheckIn);
  const checkedIn = employeeIsCheckedIn;
  dashboardContent.innerHTML = `
    <div class="employee-layout-grid" id="employee-dashboard">
      <aside class="employee-sidebar">
        <a class="employee-brand employee-page-link" data-page="dashboard" data-section="dashboard" href="#employee-dashboard-page" aria-label="LUX & Decibels home"><img class="employee-brand-logo" src="/lux-decibels-logo.png" alt=""></a>
        <button class="mobile-menu-toggle" id="employee-menu-toggle" type="button" aria-controls="employee-nav" aria-expanded="false"><span aria-hidden="true">☰</span><span class="mobile-menu-label">Menu</span></button>
        <button class="mobile-dashboard-home employee-page-link" data-page="dashboard" data-section="dashboard" type="button">← Home</button>
        <nav class="employee-nav mobile-nav-closed" id="employee-nav" aria-label="Employee navigation">
          <a class="employee-nav-link active employee-page-link" data-page="dashboard" data-section="dashboard" href="#employee-dashboard-page"><span>⌂</span>Home</a>
          <a class="employee-nav-link employee-page-link" data-page="leave" data-section="leave" href="#employee-leave-page"><span>▦</span>Leave Request</a>
          <a class="employee-nav-link employee-page-link" data-page="activity" data-section="activity" href="#employee-activity-page"><span>◴</span>My Activity</a>
          <a class="employee-nav-link employee-page-link" data-page="reports" data-section="reports" href="#employee-reports-page"><span>▥</span>Reports</a>
          <button class="employee-mobile-logout" id="employee-mobile-logout-button" type="button"><span aria-hidden="true">⇥</span>Sign out</button>
        </nav>
        <button class="employee-sidebar-logout" id="employee-logout-button" type="button"><span>⇥</span>Sign out</button>
        <span class="employee-sidebar-foot">© ${new Date().getFullYear()} LUX &amp; Decibels</span>
      </aside>
      <main class="employee-main">
        <header class="employee-welcome-header">
          <div><h1>Welcome, ${escapeHtml(currentUser.name)}</h1><p>Track attendance, manage leaves, and view monthly records.</p></div>
          <div class="employee-header-actions">
            <span class="employee-profile" aria-label="${escapeHtml(currentUser.name)}">${escapeHtml(currentUser.name.trim().slice(0, 1).toUpperCase())}</span>
          </div>
        </header>
        <section class="employee-page" id="employee-dashboard-page">
          <div class="employee-panel-grid employee-dashboard-grid">
      <section class="panel employee-attendance-panel" id="employee-attendance-panel">
        <div class="employee-card-heading">
          <div><span class="employee-section-label">ATTENDANCE</span><h2>Today's attendance</h2></div>
          <span class="employee-status ${checkedIn ? "is-checked-in" : ""}"><i></i>${checkedIn ? "Checked in" : "Checked out"}</span>
        </div>
        <p class="employee-attendance-hint">${checkedIn ? "Remember to check out when your workday is done." : "Ready to start your workday? Check in when you begin."}</p>
        <p class="employee-reminder-note">Check-in reminders repeat every minute for one hour after the scheduled time, including after a page reload. If you have not checked in 30 minutes after the scheduled time, a late check-in prompt will open and ask for a reason.</p>
        ${browserNotificationControl()}
        <div class="employee-action-row">
          <div class="employee-clock"><strong id="employee-current-time"></strong><span>Local time</span></div>
          <button class="button button-primary employee-attendance-button" id="attendance-button" type="button">${checkedIn ? "Check out" : "Check in"}</button>
        </div>
        <div class="employee-metrics">
          <article><span>First check-in</span><strong>${summary.firstCheckIn ? formatClockTime(summary.firstCheckIn) : "—"}</strong></article>
          <article><span>Last check-out</span><strong>${summary.lastCheckOut ? formatClockTime(summary.lastCheckOut) : "—"}</strong></article>
          <article><span>Working time today</span><strong>${formatDuration(summary.workedMs)}</strong></article>
        </div>
      </section>
          </div>
        </section>
        <section class="employee-page hidden" id="employee-activity-page">
          <header class="employee-page-heading"><div><span class="employee-section-label">YOUR ACTIVITY</span><h2>My Activity</h2><p>Review your attendance check-in and check-out history.</p></div></header>
          <div class="employee-panel-grid employee-activity-grid">
            <section class="panel employee-activity-panel" id="employee-activity">
              <div class="employee-activity-heading"><h2 class="panel-title">Recent activity</h2><span class="count-label">${result.events.length} ${result.events.length === 1 ? "event" : "events"}</span></div>
              <div class="history-list" id="employee-history"></div>
            </section>
          </div>
        </section>
        <section class="employee-page hidden" id="employee-leave-page">
          <header class="employee-page-heading"><div><span class="employee-section-label">TIME OFF</span><h2>Leave Request</h2><p>Apply for leave and track your request status.</p></div></header>
          <div class="employee-panel-grid employee-leave-grid">
      <section class="panel employee-leave-panel" id="employee-leave-form-panel">
        <h2 class="panel-title">Request leave</h2>
        <form id="leave-request-form">
          <div class="field-row">
            <div class="field"><label for="leave-type">Leave type</label><select id="leave-type" name="type" required><option value="">Select type</option><option>Casual</option><option>Sick</option><option>Earned</option><option>Other</option></select></div>
          </div>
          <div class="field-row">
            <div class="field"><label for="leave-start">Start date</label><input id="leave-start" name="startDate" type="date" required></div>
            <div class="field"><label for="leave-end">End date</label><input id="leave-end" name="endDate" type="date" required></div>
          </div>
          <div class="field"><label for="leave-reason">Reason</label><input id="leave-reason" name="reason" required maxlength="300" placeholder="Brief reason for the leave"></div>
          <button class="button button-primary" type="submit">Submit leave request</button>
          <p class="form-error" id="leave-form-error" role="alert"></p>
        </form>
      </section>
      <section class="panel employee-leave-history-panel">
        <h2 class="panel-title">My leave requests <span class="count-label">${leaveResult.leaves.length} total</span></h2>
        <div class="leave-request-list" id="employee-leave-list"></div>
      </section>
          </div>
        </section>
        <section class="employee-page hidden" id="employee-reports-page">
          <header class="employee-page-heading"><div><span class="employee-section-label">YOUR RECORDS</span><h2>Monthly Report</h2><p>Review your attendance and leave details by month.</p></div></header>
          <div class="employee-panel-grid">
      <section class="panel employee-monthly-panel" id="employee-monthly-panel">
        <div id="employee-monthly-report"></div>
      </section>
          </div>
        </section>
      </main>
    </div>`;
  startEmployeeClock();
  renderEvents(document.querySelector("#employee-history"), result.events, false);
  document.querySelector("#attendance-button").addEventListener("click", toggleAttendance);
  document.querySelector("#late-checkin-form").addEventListener("submit", submitLateCheckIn);
  document.querySelector("#late-checkin-cancel").addEventListener("click", () => lateCheckInDialog.close());
  document.querySelector("#late-checkin-close").addEventListener("click", () => lateCheckInDialog.close());
  const enableNotificationsButton = document.querySelector("#enable-notifications");
  if (enableNotificationsButton) enableNotificationsButton.addEventListener("click", enableBrowserNotifications);
  document.querySelector("#leave-request-form").addEventListener("submit", submitLeaveRequest);
  renderEmployeeLeaves(leaveResult.leaves);
  renderEmployeeMonthlyReport(reportResult);
  document.querySelector("#employee-logout-button").addEventListener("click", logout);
  document.querySelector("#employee-mobile-logout-button").addEventListener("click", logout);
  setupEmployeeNavigation();
  startEmployeeReminders();
}

function setupEmployeeNavigation() {
  const links = [...document.querySelectorAll(".employee-page-link")];
  const pages = {
    dashboard: document.querySelector("#employee-dashboard-page"),
    leave: document.querySelector("#employee-leave-page"),
    activity: document.querySelector("#employee-activity-page"),
    reports: document.querySelector("#employee-reports-page"),
  };
  for (const link of links) {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      const page = pages[link.dataset.page];
      if (!page) return;
      for (const item of Object.values(pages)) item.classList.add("hidden");
      page.classList.remove("hidden");
      const section = link.dataset.section || link.dataset.page;
      document.querySelectorAll(".employee-nav-link").forEach((item) => {
        item.classList.toggle("active", item.dataset.section === section);
      });
      if (link.dataset.target) {
        document.querySelector(`#${link.dataset.target}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      } else {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
      setMobileMenuVisibility("employee-menu-toggle", "employee-nav", link.dataset.page === "dashboard");
    });
  }
  setupMobileMenu("employee-menu-toggle", "employee-nav");
}

function setupMobileMenu(buttonId, navId) {
  const button = document.querySelector(`#${buttonId}`);
  const nav = document.querySelector(`#${navId}`);
  button.addEventListener("click", () => {
    const isOpen = button.getAttribute("aria-expanded") !== "true";
    button.setAttribute("aria-expanded", String(isOpen));
    button.querySelector(".mobile-menu-label").textContent = isOpen ? "Close" : "Menu";
    button.querySelector("[aria-hidden]").textContent = isOpen ? "×" : "☰";
    nav.classList.toggle("mobile-nav-closed", !isOpen);
    nav.classList.toggle("mobile-nav-open", isOpen);
  });
}

function setMobileMenuVisibility(buttonId, navId, visible) {
  const button = document.querySelector(`#${buttonId}`);
  const nav = document.querySelector(`#${navId}`);
  const disabled = !visible;
  button.closest(".employee-sidebar").classList.toggle("mobile-subpage", disabled);
  button.classList.toggle("mobile-nav-disabled", disabled);
  nav.classList.toggle("mobile-nav-disabled", disabled);
  if (disabled) {
    button.setAttribute("aria-expanded", "false");
    button.querySelector(".mobile-menu-label").textContent = "Menu";
    button.querySelector("[aria-hidden]").textContent = "☰";
    nav.classList.add("mobile-nav-closed");
    nav.classList.remove("mobile-nav-open");
  }
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function browserNotificationControl() {
  if (!window.isSecureContext) {
    return '<p class="notification-help">System notifications require a secure HTTPS connection. In-app reminders appear while this page is open.</p>';
  }
  if (!("Notification" in window)) {
    return '<p class="notification-help">System notifications are not supported in this browser. In-app reminders appear while this page is open.</p>';
  }
  if (Notification.permission === "granted") {
    return '<p class="notification-help">Browser notifications are enabled. Keep this app open for browser reminders. To receive Windows reminders with the browser closed, install the scheduled reminders using install-reminders.ps1.</p>';
  }
  if (Notification.permission === "denied") {
    return '<p class="notification-help">Chrome notifications are blocked for this site. Click the site controls icon to the left of the address bar, open Site settings, set Notifications to Allow, then reload this page. Windows reminders work separately.</p>';
  }
  return '<div class="notification-permission-prompt"><p>Allow browser notifications for attendance reminders?</p><button class="button button-quiet employee-notification-button" id="enable-notifications" type="button">Allow notifications</button></div>';
}

async function enableBrowserNotifications(event) {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      showToast("Browser notifications enabled.");
      await renderEmployee();
    } else if (permission === "denied") {
      showToast("Browser notifications are blocked. In-app reminders are still active.", true);
      button.textContent = "Browser notifications blocked";
    } else {
      button.disabled = false;
    }
  } catch (error) {
    button.disabled = false;
    showToast(error.message || "Unable to enable browser notifications.", true);
  }
}

async function submitLeaveRequest(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const error = document.querySelector("#leave-form-error");
  error.textContent = "";
  const data = Object.fromEntries(new FormData(form));
  try {
    await api("/api/leaves", { method: "POST", body: JSON.stringify(data) });
    showToast("Leave request submitted for approval.");
    await renderEmployee();
  } catch (requestError) {
    error.textContent = requestError.message;
  }
}

function renderEmployeeLeaves(leaves) {
  const container = document.querySelector("#employee-leave-list");
  if (!container) return;
  if (!leaves.length) {
    container.innerHTML = '<p class="empty-state">You have not submitted any leave requests.</p>';
    return;
  }
  container.innerHTML = "";
  for (const leave of leaves) {
    const card = document.createElement("article");
    card.className = "leave-request";
    card.innerHTML = `
      <div class="leave-request-heading"><strong></strong><span class="leave-status"></span></div>
      <div class="leave-meta"></div>
      <p class="leave-reason"></p>
      <div class="leave-actions"></div>`;
    card.querySelector("strong").textContent = leave.type;
    card.querySelector(".leave-status").textContent = leave.status;
    card.querySelector(".leave-status").classList.add(`status-${leave.status}`);
    card.querySelector(".leave-meta").textContent = `${formatDate(leave.startDate)} – ${formatDate(leave.endDate)} (${leaveDays(leave.startDate, leave.endDate)} ${leaveDays(leave.startDate, leave.endDate) === 1 ? "day" : "days"})`;
    card.querySelector(".leave-reason").textContent = leave.reason;
    if (["pending", "approved"].includes(leave.status)) {
      const cancelButton = document.createElement("button");
      cancelButton.type = "button";
      cancelButton.className = "leave-action leave-action-cancelled";
      cancelButton.textContent = "Cancel leave";
      cancelButton.addEventListener("click", () => cancelEmployeeLeave(leave.id));
      card.querySelector(".leave-actions").append(cancelButton);
    }
    container.append(card);
  }
}

async function cancelEmployeeLeave(leaveId) {
  if (!window.confirm("Cancel this leave request?")) return;
  try {
    await api(`/api/leaves/${encodeURIComponent(leaveId)}/cancel`, { method: "PATCH" });
    showToast("Leave request cancelled.");
    await renderEmployee();
  } catch (requestError) {
    showToast(requestError.message || "Unable to cancel leave request.", true);
  }
}

async function loadEmployeeMonthlyReport(month) {
  if (!month) return;
  try {
    renderEmployeeMonthlyReport(await api(`/api/reports/monthly?month=${encodeURIComponent(month)}`));
  } catch (error) {
    showToast(error.message, true);
  }
}

function renderEmployeeMonthlyReport(result) {
  const container = document.querySelector("#employee-monthly-report");
  if (!container) return;
  const record = result.report[0];
  if (!record) {
    container.innerHTML = '<p class="empty-state">No monthly report data is available.</p>';
    return;
  }
  renderCalendarReport(container, record, result.month, loadEmployeeMonthlyReport);
}

function startEmployeeReminders() {
  stopEmployeeReminders();
  checkEmployeeReminders();
  employeeReminderTimer = setInterval(checkEmployeeReminders, 30000);
  if (!employeeReminderListenersInstalled) {
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) checkEmployeeReminders();
    });
    window.addEventListener("focus", () => checkEmployeeReminders());
    employeeReminderListenersInstalled = true;
  }
}

function startEmployeeClock() {
  stopEmployeeClock();
  updateEmployeeClock();
  employeeClockTimer = setInterval(updateEmployeeClock, 1000);
}

function stopEmployeeClock() {
  clearInterval(employeeClockTimer);
  employeeClockTimer = null;
}

function updateEmployeeClock() {
  const clock = document.querySelector("#employee-current-time");
  if (clock) {
    clock.textContent = new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date());
  }
}

function stopEmployeeReminders() {
  clearInterval(employeeReminderTimer);
  employeeReminderTimer = null;
}

function checkEmployeeReminders(now = new Date()) {
  if (!currentUser || currentUser.role !== "employee") return;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const morningMinutes = reminderMinutes(EMPLOYEE_REMINDER_TIMES.morning);
  const eveningMinutes = reminderMinutes(EMPLOYEE_REMINDER_TIMES.evening);
  const dateKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  const checkInDeadline = lateCheckInDate(now);
  const checkInReminderEnd = new Date(
    scheduledCheckInDate(now).getTime() + EMPLOYEE_CHECK_IN_REMINDER_DURATION_MS,
  );

  if (now >= checkInDeadline && attendanceNotification.classList.contains("is-reminder")) {
    clearTimeout(attendanceNotificationTimer);
    attendanceNotification.classList.add("hidden");
  }

  const latePromptKey = `${currentUser.id}:${dateKey}`;
  if (
    !employeeIsCheckedIn &&
    !employeeHasCheckedInToday &&
    now >= checkInDeadline &&
    !shownLateCheckInPrompts.has(latePromptKey) &&
    !lateCheckInDialog.open
  ) {
    openLateCheckInDialog(now);
  }

  if (!employeeIsCheckedIn && minutes >= morningMinutes && now < checkInReminderEnd) {
    sendEmployeeReminder("morning", dateKey, "Time to check in", "You're currently checked out.", now);
  }
  if (employeeIsCheckedIn && minutes >= eveningMinutes) {
    sendEmployeeReminder("evening", dateKey, "Time to check out", "You're still checked in. Remember to check out.", now);
  }
}

function reminderMinutes(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function sendEmployeeReminder(kind, dateKey, title, body, now) {
  const reminderKey = `${currentUser.id}:${dateKey}:${kind}`;
  const storageKey = `team-attendance.reminder.${reminderKey}`;
  const storedLastSentAt = Number(localStorage.getItem(storageKey));
  const lastSentAt = Math.max(
    sentEmployeeReminders.get(reminderKey) || 0,
    Number.isFinite(storedLastSentAt) ? storedLastSentAt : 0,
  );
  if (lastSentAt > 0 && (
    kind !== "morning" || now.getTime() - lastSentAt < EMPLOYEE_CHECK_IN_REMINDER_INTERVAL_MS
  )) return;
  sentEmployeeReminders.set(reminderKey, now.getTime());
  localStorage.setItem(storageKey, String(now.getTime()));
  if (kind === "morning") showCheckInReminderNotification();
  else showCheckOutReminderNotification();
  if ("Notification" in window && Notification.permission === "granted") {
    try {
      new Notification(title, {
        body,
        tag: reminderKey,
        renotify: true,
        requireInteraction: true,
      });
    } catch (error) {
      showToast(error.message || "Unable to show a browser notification.", true);
    }
  }
}

function summarizeToday(events, now = new Date()) {
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const todayEvents = events
    .map((event) => ({ ...event, timestamp: new Date(event.at).getTime() }))
    .filter((event) => event.timestamp >= startOfDay && event.timestamp <= now.getTime())
    .sort((a, b) => a.timestamp - b.timestamp);
  let firstCheckIn = null;
  let lastCheckOut = null;
  let activeCheckIn = null;
  let workedMs = 0;

  for (const event of todayEvents) {
    if (event.type === "check-in") {
      if (!firstCheckIn) firstCheckIn = new Date(event.timestamp);
      activeCheckIn = event.timestamp;
    } else {
      lastCheckOut = new Date(event.timestamp);
      if (activeCheckIn !== null) {
        workedMs += event.timestamp - activeCheckIn;
        activeCheckIn = null;
      }
    }
  }

  if (activeCheckIn !== null) workedMs += now.getTime() - activeCheckIn;
  return { firstCheckIn, lastCheckOut, workedMs };
}

function formatClockTime(date) {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
}

function formatDuration(milliseconds) {
  const totalMinutes = Math.floor(milliseconds / 60000);
  return `${Math.floor(totalMinutes / 60)}h ${String(totalMinutes % 60).padStart(2, "0")}m`;
}

function formatDate(date) {
  return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" })
    .format(new Date(`${date}T00:00:00`));
}

function leaveDays(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
}

function renderEvents(container, events, showNames) {
  if (!events.length) {
    container.innerHTML = '<p class="empty-state">No attendance activity yet.</p>';
    return;
  }
  const orderedEvents = showNames ? [...events].reverse() : events;
  for (const event of orderedEvents) {
    const row = document.createElement("div");
    row.className = "history-row";
    const label = event.type === "check-in" ? "Checked in" : "Checked out";
    const time = new Intl.DateTimeFormat(undefined, { dateStyle: showNames ? "short" : undefined, timeStyle: "short" }).format(new Date(event.at));
    row.innerHTML = `<span class="history-event"><i></i><span class="event-label"></span></span><span class="history-time"></span>`;
    if (showNames && event.employeeName) row.querySelector(".event-label").textContent = `${event.employeeName} · ${label}`;
    else row.querySelector(".event-label").textContent = label;
    row.querySelector(".history-event i").classList.toggle("out", event.type === "check-out");
    row.querySelector(".history-time").textContent = time;
    container.append(row);
  }
}

function renderAdminAttendance(container, events) {
  const checkedIn = events.filter((event) => event.type === "check-in");
  const checkedOut = events.filter((event) => event.type === "check-out");

  container.innerHTML = `
    <section class="admin-attendance-column">
      <h3>Checked in <span class="count-label">${checkedIn.length}</span></h3>
      <div class="history-list" id="admin-checked-in"></div>
    </section>
    <section class="admin-attendance-column">
      <h3>Checked out <span class="count-label">${checkedOut.length}</span></h3>
      <div class="history-list" id="admin-checked-out"></div>
    </section>`;

  renderEvents(container.querySelector("#admin-checked-in"), checkedIn, true);
  renderEvents(container.querySelector("#admin-checked-out"), checkedOut, true);
}

async function toggleAttendance() {
  const type = employeeIsCheckedIn ? "check-out" : "check-in";
  if (type === "check-in" && new Date() >= lateCheckInDate(new Date())) {
    openLateCheckInDialog();
    return;
  }
  await recordAttendance(type);
}

function scheduledCheckInDate(now) {
  const [hours, minutes] = EMPLOYEE_SCHEDULED_CHECK_IN.split(":").map(Number);
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes);
}

function lateCheckInDate(now) {
  return new Date(scheduledCheckInDate(now).getTime() + EMPLOYEE_LATE_CHECK_IN_DELAY_MS);
}

function openLateCheckInDialog(now = new Date()) {
  const dateKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
  if (currentUser) shownLateCheckInPrompts.add(`${currentUser.id}:${dateKey}`);
  document.querySelector("#late-checkin-current-time").textContent = formatClockTime(now);
  document.querySelector("#late-checkin-scheduled-time").textContent = formatClockTime(scheduledCheckInDate(now));
  document.querySelector("#late-checkin-reason").value = "";
  document.querySelector("#late-checkin-error").textContent = "";
  document.querySelector("#late-checkin-submit").disabled = false;
  lateCheckInDialog.showModal();
  document.querySelector("#late-checkin-reason").focus();
}

async function submitLateCheckIn(event) {
  event.preventDefault();
  const reasonInput = document.querySelector("#late-checkin-reason");
  const reason = reasonInput.value.trim();
  if (!reason) {
    document.querySelector("#late-checkin-error").textContent = "Please enter a reason for your late check-in.";
    reasonInput.focus();
    return;
  }
  document.querySelector("#late-checkin-submit").disabled = true;
  try {
    if (await recordAttendance("check-in", reason)) lateCheckInDialog.close();
  } finally {
    document.querySelector("#late-checkin-submit").disabled = false;
  }
}

async function recordAttendance(type, reason) {
  const button = document.querySelector("#attendance-button");
  button.disabled = true;
  try {
    const body = { type };
    if (reason) body.reason = reason;
    await api("/api/attendance", { method: "POST", body: JSON.stringify(body) });
    showAttendanceNotification(type);
    showBrowserAttendanceNotification(type);
    await renderEmployee();
    return true;
  } catch (error) {
    button.disabled = false;
    if (lateCheckInDialog.open) {
      document.querySelector("#late-checkin-error").textContent = error.message;
    } else {
      showToast(error.message, true);
    }
    return false;
  }
}

loadSession().catch((error) => {
  console.error(error);
  showToast("Unable to connect to the attendance app. Refresh to try again.", true);
});

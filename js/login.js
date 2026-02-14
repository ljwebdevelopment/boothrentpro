// Redirect already-logged-in admins immediately.
const isLoggedIn =
  localStorage.getItem("boothrent_admin") === "true" ||
  sessionStorage.getItem("boothrent_admin") === "true";

if (isLoggedIn) {
  window.location.href = "/html/dashboard.html";
}

const loginForm = document.getElementById("loginForm");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const rememberMeInput = document.getElementById("rememberMe");
const loginButton = document.getElementById("loginBtn");
const errorText = document.getElementById("errorText");
const loginCard = document.getElementById("loginCard");
const togglePasswordButton = document.getElementById("togglePassword");

// Hard-coded admins. Slots 3 and 4 are placeholders and intentionally blocked.
const ADMIN_CREDENTIALS = [
  { email: "Emilyhullinger1989@yahoo.com", password: "Twins2010!" },
  { email: "thestraightedge514@gmail.com", password: "Twins2010!" },
  { email: "", password: "" },
  { email: "", password: "" },
];

function normalizeEmail(value) {
  return value.trim().toLowerCase();
}

function showError(message) {
  errorText.textContent = message;
  loginCard.classList.remove("shake");
  void loginCard.offsetWidth;
  loginCard.classList.add("shake");
}

function clearError() {
  errorText.textContent = "";
}

togglePasswordButton.addEventListener("click", () => {
  const isHidden = passwordInput.type === "password";
  passwordInput.type = isHidden ? "text" : "password";
  togglePasswordButton.textContent = isHidden ? "Hide" : "Show";
  togglePasswordButton.setAttribute("aria-label", isHidden ? "Hide password" : "Show password");
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearError();

  const enteredEmail = normalizeEmail(emailInput.value);
  const enteredPassword = passwordInput.value;

  if (!enteredEmail || !enteredPassword) {
    showError("Please enter both your email and password.");
    return;
  }

  // Match email case-insensitively, but skip empty placeholder accounts.
  const matchedAdmin = ADMIN_CREDENTIALS.find((admin) => {
    if (!admin.email.trim()) return false;
    return normalizeEmail(admin.email) === enteredEmail;
  });

  if (!matchedAdmin || matchedAdmin.password !== enteredPassword) {
    showError("Invalid credentials. Please try again.");
    return;
  }

  loginButton.disabled = true;
  loginButton.classList.add("loading");

  // Simulated loading state before redirect.
  await new Promise((resolve) => setTimeout(resolve, 600));

  if (rememberMeInput.checked) {
    localStorage.setItem("boothrent_admin", "true");
  } else {
    sessionStorage.setItem("boothrent_admin", "true");
  }

  // Store current admin email for messages logging.
  localStorage.setItem("boothrent_admin_email", matchedAdmin.email);

  window.location.href = "/html/dashboard.html";
});

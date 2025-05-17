function setCookie(name, value, days) {
  const date = new Date();
  date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
  document.cookie = `${name}=${value}; expires=${date.toUTCString()}; path=/`;
}

function getCookie(name) {
  const cookies = document.cookie.split("; ");
  for (const cookie of cookies) {
    const [key, value] = cookie.split("=");
    if (key === name) return value;
  }
  return null;
}

function toggleTheme() {
  const currentTheme = document.body.dataset.theme || "light";
  const newTheme = currentTheme === "dark" ? "light" : "dark";
  document.body.dataset.theme = newTheme;
  setCookie("theme", newTheme, 7);
}

document.addEventListener("DOMContentLoaded", () => {
  const savedTheme = getCookie("theme");
  if (savedTheme) {
    document.body.dataset.theme = savedTheme;
  } else {
    document.body.dataset.theme = "light";
  }
});

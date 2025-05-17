const elements = {
  joinRoomBtn: document.getElementById("join-room-btn"),
  errorMessage: document.getElementById("error-message"),
  username: document.getElementById("username"),
  roomIDInput: document.getElementById("roomID"),
};

const showError = (message) => {
  elements.errorMessage.textContent = message;
  elements.errorMessage.classList.remove("hidden");
};

const hideError = () => {
  elements.errorMessage.textContent = "";
  elements.errorMessage.classList.add("hidden");
};

const joinRoom = async () => {
  try {
    const username = elements.username.value.trim();
    const roomID = elements.roomIDInput.value.trim();

    hideError();

    if (!username || username.length < 4 || username.length > 20) {
      showError("Username must be between 4 and 10 characters.");
      return;
    }
    localStorage.setItem("username", username);

    const response = await fetch("/api/joinroom", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, roomID }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      showError(errorData.error || "Unknown error.");
      return;
    }

    window.location.href = `/room?id=${roomID}`;
  } catch (error) {
    showError(error.message);
  }
};

const storedUsername = localStorage.getItem("username");

if (storedUsername) {
  elements.username.value = storedUsername;
}

elements.joinRoomBtn.addEventListener("click", joinRoom);

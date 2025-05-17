const elements = {
  numQuestions: document.getElementById("num-questions"),
  timeLimit: document.getElementById("time-limit"),
  createRoomBtn: document.getElementById("create-room-btn"),
  errorMessage: document.getElementById("error-message"),
  hostUsername: document.getElementById("host-username"),
  rangeValueQ: document.getElementById("range-value-q"),
  rangeValueT: document.getElementById("range-value-t"),
  gameType: document.getElementById("game-type"),
};

var gameMode = "MCQ";

const handleRangeInput = (event, displayElement) => {
  displayElement.textContent = event.target.value;
};

const showError = (message) => {
  elements.errorMessage.textContent = message;
  elements.errorMessage.classList.remove("hidden");
};

const hideError = () => {
  elements.errorMessage.textContent = "";
  elements.errorMessage.classList.add("hidden");
};

document.querySelectorAll('input[name="game-type"]').forEach((radio) => {
  radio.addEventListener("change", (event) => {
    gameMode = event.target.value;
  });
});

const createRoom = async () => {
  try {
    const timeLimit = parseInt(elements.timeLimit.value, 10);
    const numQuestions = parseInt(elements.numQuestions.value, 10);
    const host = elements.hostUsername.value.trim();
    const gameType = gameMode;

    hideError();

    if (!host || host.length < 4 || host.length > 20) {
      showError("Username must be between 4 and 10 characters.");
      return;
    }
    localStorage.setItem("username", host);

    const response = await fetch("/api/createroom", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        timeLimit,
        numQuestions,
        gameType,
        hostUsername: host,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || "Unknown error.");
    }

    const data = await response.json();
    window.location.href = `/room?id=${data.code}`;
  } catch (error) {
    showError(error.message);
  }
};

const storedUsername = localStorage.getItem("username");

if (storedUsername) {
  elements.hostUsername.value = storedUsername;
}

elements.numQuestions.addEventListener("input", (e) =>
  handleRangeInput(e, elements.rangeValueQ),
);
elements.timeLimit.addEventListener("input", (e) =>
  handleRangeInput(e, elements.rangeValueT),
);
elements.createRoomBtn.addEventListener("click", createRoom);

import GameLogic from "./game.js";

class MultiplayerGameController {
  constructor() {
    this.elements = this.cacheElements();
    this.username = localStorage.getItem("username");
    this.roomID = new URLSearchParams(window.location.search).get("id");
    this.socket = null;
    this.funwithflags = new GameLogic();
    this.gametype = null;
    this.totalquestions = 0;
    this.gamestarted = false;
    this.gameended = false;
    this.ishost = false;
    this.gameTime = 0;

    this.gamePlayers = {}; // Structure: { playerId: { name, score } }
    this.currentQuestion = {}; // Structure: {type: "map/mcq", options = [], flag_url }
    this.currentQuestionIndex = 0;

    this.initEventListeners();
    this.initializeRoom();
  }

  cacheElements() {
    return {
      // waiting room
      waitingroom: document.getElementById("waiting-room"),

      // room info table
      roomCode: document.getElementById("room-code-value"),
      hostName: document.getElementById("host-name-value"),
      numPlayers: document.getElementById("num-players-value"),
      numQuestions: document.getElementById("num-questions-value"),
      gamemode: document.getElementById("gamemode-value"),
      timeLimit: document.getElementById("time-limit-value"),
      playername: document.getElementById("username-value"),
      playerList: document.getElementById("player-list"),

      // modals and messages
      errorMessage: document.getElementById("error-message"),
      modal: document.getElementById("question-modal"),
      modalUsernameInput: document.getElementById("username"),
      modalJoinButton: document.getElementById("join-room-btn"),
      errorModal: document.getElementById("room-error-modal"),
      errorModalMessage: document.getElementById("room-error-message"),

      // Game elements
      flag: document.getElementById("flag"),
      options: document.getElementById("options"),
      progressMCQ: document.getElementById("progress-mcq"),
      progressMap: document.getElementById("progress-map"),
      game: document.getElementById("game"),
      gameModal: document.getElementById("game-modal"),
      finalScore: document.getElementById("final-score"),
      startGameBtn: document.getElementById("start-game-btn"),
      gameMCQ: document.getElementById("game-mcq"),
      gameMap: document.getElementById("game-map"),
      flagMap: document.getElementById("flag-map"),
      mapContainer: document.querySelector(".map-container"),
      gameTimer: document.getElementById("game-timer"),

      // Leaderboard
      leaderboardIcon: document.querySelector(".leaderboard-icon"),
      sidebar: document.querySelector(".sidebar"),
      closeSidebarBtn: document.querySelector(".close-sidebar"),
      leaderboardBody: document.getElementById("leaderboard-body"),
    };
  }

  initEventListeners() {
    this.elements.modalJoinButton.addEventListener("click", () => {
      const inputUsername = this.elements.modalUsernameInput.value.trim();
      if (
        !inputUsername ||
        inputUsername.length < 4 ||
        inputUsername.length > 20
      ) {
        this.showError("Username must be between 4 and 10 characters.");
        return;
      }

      this.username = inputUsername;
      localStorage.setItem("username", this.username);
      this.closeModal();
      this.fetchRoomDetails();
    });

    this.elements.leaderboardIcon.addEventListener("click", () => {
      this.toggleSidebar();
    });
    this.elements.closeSidebarBtn.addEventListener("click", () => {
      this.toggleSidebar();
    });

    document.addEventListener("click", (e) => {
      if (
        !this.elements.sidebar.contains(e.target) &&
        !this.elements.leaderboardIcon.contains(e.target) &&
        this.elements.sidebar.classList.contains("active")
      ) {
        this.toggleSidebar();
      }
    });
  }

  fetchRoomDetails = async () => {
    try {
      const response = await fetch(`/api/room/${this.roomID}`);
      if (!response.ok) {
        if (response.status === 404) {
          this.showErrorModal("Room not found or has ended.");
        } else {
          throw new Error("Failed to fetch room details.");
        }
        return;
      }
      const data = await response.json();

      this.populateRoomInfo(data);
      this.totalquestions = data.numQuestions;
      this.elements.playername.textContent = this.username;
      this.gametype = data.gamemode;
      this.gameTime = data.timeLimit;

      data.players.forEach((player) => {
        this.addPlayer(player.id, player.username);
      });

      this.updatePlayerCount();

      const isHost = this.username === data.host;
      const gameStartContainer = document.querySelector(".game-start");
      const button = gameStartContainer.querySelector("button");
      const message = gameStartContainer.querySelector("p");

      if (isHost) {
        this.ishost = true;
        button.classList.remove("hidden");
        message.classList.add("hidden");
        button.addEventListener("click", () => {
          this.loadgame();
        });
      } else {
        button.classList.add("hidden");
        message.classList.remove("hidden");
      }
    } catch (error) {
      this.showErrorModal(error.message);
    }
  };

  initializeRoom() {
    if (!this.username) {
      this.askForUsername();
    } else {
      this.fetchRoomDetails();
    }
  }

  loadgame() {
    if (!this.ishost) {
      alert("Only the game host can start the game, you are not the host.");
      return;
    }

    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      console.error("WebSocket is not open. Cannot start the game.");
      return;
    }

    this.hidewaitingroom();

    this.gamestarted = true;

    this.socket.send(JSON.stringify({ event: "loadgame" }));
  }

  startGame() {
    try {
      if (this.gametype === "MAP") {
        this.funwithflags.loadMapCSSAndJS(() => {
          this.funwithflags.initializeMap("map");

          const map = this.funwithflags.map;

          map.on("click", (event) => {
            const clickedFeature = map.forEachFeatureAtPixel(
              event.pixel,
              (feature) => feature,
            );

            if (clickedFeature) {
              const userSelectedCountry = clickedFeature.get("name");

              this.handleMapClick(userSelectedCountry);
            } else {
              alert("Please select a valid country.");
            }
          });
        });
      }

      this.toggleVisibility(this.elements.game, true);
      this.startTimer(this.gameTime);
    } catch (error) {
      this.showError("An error occurred while starting the game.");
      console.error(error);
    }
  }

  handleMapClick(selectedCountry) {
    this.requestAnswer(this.currentQuestionIndex, selectedCountry);
  }

  shuffleOptions(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  loadQuestion() {
    if (this.gameended) return;
    if (this.gametype === "MCQ") {
      this.toggleVisibility(this.elements.gameMCQ, true);
      this.toggleVisibility(this.elements.gameMap, false);

      this.elements.flag.src = this.currentQuestion.flag_url;
      const optionsArray = [...this.currentQuestion.options];
      this.shuffleOptions(optionsArray);

      this.elements.options.innerHTML = optionsArray
        .map((option) => `<button class="option">${option}</button>`)
        .join("");

      if (this.elements.options.children.length > 0) {
        Array.from(this.elements.options.children).forEach((button) => {
          button.onclick = () =>
            this.requestAnswer(this.currentQuestionIndex, button.textContent);
        });
      }
    } else if (this.gametype === "MAP") {
      this.toggleVisibility(this.elements.gameMCQ, false);
      this.toggleVisibility(this.elements.gameMap, true);

      this.elements.flagMap.src = this.currentQuestion.flag_url;
    }
  }

  // send from websocketclient
  requestQuestion(questionNumber) {
    if (this.gameended) return;
    if (
      typeof questionNumber !== "number" ||
      questionNumber < 0 ||
      questionNumber > this.totalquestions
    ) {
      console.error("Invalid question number.");
      return;
    }

    this.funwithflags.updateProgress(
      this.gametype === "MCQ"
        ? this.elements.progressMCQ
        : this.elements.progressMap,
      this.currentQuestionIndex,
      this.totalquestions,
    );

    this.socket.send(
      JSON.stringify({
        event: "get_new_question",
        data: {
          roomID: this.roomID,
          playerID: this.username,
          question_number: questionNumber,
        },
      }),
    );
  }

  // send from game controller
  requestAnswer(question_index, answer) {
    if (this.gameended) return;
    if (typeof question_index !== "number" || question_index < 0) {
      console.error("Invalid question index.");
      return;
    }

    if (!answer || typeof answer !== "string") {
      console.error("Invalid answer: ", answer);
      return;
    }

    this.socket.send(
      JSON.stringify({
        event: "validate_answer",
        data: {
          question_index: question_index,
          answer: answer,
        },
      }),
    );
  }

  verifyAnswer(data) {
    if (this.gameended) return;
    if (this.gametype == "MAP") {
      this.funwithflags.handleMapClick(data.chosen_answer, data.correct_answer);
      setTimeout(() => {
        this.moveToNextQuestion();
      }, 4000);
    } else {
      const correctAnswer = data.correct_answer;
      const chosenAnswer = data.chosen_answer;

      const buttons = document.querySelectorAll(".option");
      const selectedButton = Array.from(buttons).find(
        (button) => button.textContent === chosenAnswer,
      );

      const isCorrect = chosenAnswer === correctAnswer;
      if (selectedButton) {
        selectedButton.style.backgroundColor = isCorrect
          ? "#a8d5a2"
          : "#f5a9a9";
        selectedButton.style.color = "#333";
      }

      if (!isCorrect) {
        const correctButton = Array.from(buttons).find(
          (button) => button.textContent === correctAnswer,
        );
        if (correctButton) {
          correctButton.style.backgroundColor = "#a8d5a2";
          correctButton.style.color = "#333";
        }
      }
      setTimeout(() => {
        buttons.forEach((button) => (button.disabled = false));
        this.moveToNextQuestion();
      }, 2000);
    }
  }

  moveToNextQuestion() {
    if (this.currentQuestionIndex < this.totalquestions - 1) {
      this.currentQuestionIndex += 1;
      this.requestQuestion(this.currentQuestionIndex);
    }
  }

  //
  // UI event handlers
  //
  populatePlayerList(players) {
    this.elements.playerList.innerHTML = "";
    players.forEach((player) => {
      const li = document.createElement("li");
      li.textContent = `${player.username}`;
      li.setAttribute("data-id", player.id);
      this.elements.playerList.appendChild(li);
    });

    const leaderboardData = players
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .map((player) => ({
        name: player.username,
        score: player.score || 0,
      }));
    this.renderLeaderboard(leaderboardData);
  }

  syncUI() {
    const players = Object.entries(this.gamePlayers).map(([id, player]) => ({
      id,
      username: player.name,
      score: player.score,
    }));
    this.populatePlayerList(players);
  }

  toggleSidebar() {
    this.elements.sidebar.classList.toggle("active");
  }

  toggleVisibility(element, visible) {
    element.classList.toggle("hidden", !visible);
  }

  showErrorModal(message) {
    this.elements.waitingroom.classList.add("hidden");
    this.elements.errorModalMessage.textContent = message;
    this.elements.errorModal.classList.remove("hidden");
  }

  showError(message) {
    this.elements.errorMessage.textContent = message;
    this.toggleVisibility(this.elements.errorMessage, true);
  }

  hideError() {
    this.elements.errorMessage.textContent = "";
    this.toggleVisibility(this.elements.errorMessage, false);
  }

  askForUsername() {
    this.elements.modal.classList.remove("hidden");
  }

  closeModal() {
    this.elements.modal.classList.add("hidden");
  }

  populateRoomInfo(data) {
    this.elements.roomCode.textContent = data.code;
    this.elements.hostName.textContent = data.host;
    this.elements.numPlayers.textContent = Object.keys(this.gamePlayers).length;
    this.elements.numQuestions.textContent = data.numQuestions;
    this.elements.timeLimit.textContent = data.timeLimit;
    this.elements.gamemode.textContent = data.gamemode;
  }

  hidewaitingroom() {
    this.toggleVisibility(this.elements.waitingroom, false);
  }

  //
  // Handle websocket events related to players and game state
  //
  addPlayer(playerId, playerName) {
    if (!this.gamePlayers[playerId]) {
      this.gamePlayers[playerId] = { name: playerName, score: 0 };
    }
    this.syncUI();
  }

  removePlayer(playerId, playerName) {
    if (this.gamePlayers[playerId]) {
      if (this.gamePlayers[playerId].name == playerName) {
        delete this.gamePlayers[playerId];
      }
    }
    this.syncUI();
  }

  updateScore(playerId, newScore) {
    if (this.gamePlayers[playerId]) {
      this.gamePlayers[playerId].score = newScore;
    }
    this.syncUI();
  }

  updateCurrentQuestion(data) {
    this.currentQuestion.type = this.gametype;
    this.currentQuestion.options = data.options;
    this.currentQuestion.flag_url = data.flag_url;
  }

  getPlayers() {
    return Object.entries(this.gamePlayers).map(([id, player]) => ({
      id,
      name: player.name,
      score: player.score,
    }));
  }

  updatePlayerCount() {
    const playerCount = Object.keys(this.gamePlayers).length;
    this.elements.numPlayers.textContent = playerCount;
  }

  scoreUpdate(data) {
    const rows = Array.from(this.elements.leaderboardBody.children);
    const playerRow = rows.find((row) =>
      row.children[1].textContent.includes(data.username),
    );
    if (playerRow) {
      const scoreCell = playerRow.children[2];
      scoreCell.textContent = parseInt(data.score);

      const leaderboardData = rows.map((row) => ({
        name: row.children[1].textContent.replace(" (You)", ""),
        score: parseInt(row.children[2].textContent),
      }));

      leaderboardData.sort((a, b) => b.score - a.score);

      this.renderLeaderboard(leaderboardData);
    }
  }

  renderLeaderboard(data) {
    this.elements.leaderboardBody.innerHTML = data
      .map(
        (player, index) => `
            <tr>
                <td>${index + 1}</td>
                <td>${player.name} ${this.username === player.name ? "(You)" : ""}</td>
                <td>${player.score}</td>
            </tr>
        `,
      )
      .join("");
  }

  timeover() {
    this.gameended = true;
    alert("Game over");
    this.toggleSidebar();
  }

  startTimer(minutes) {
    const timerSpan = document.getElementById("game-timer");

    if (!timerSpan) {
      console.error("Timer element not found!");
      return;
    }

    let totalSeconds = Math.max(0, minutes * 60);
    updateDisplay();

    const timerInterval = setInterval(() => {
      if (this.gameended) {
        clearInterval(timerInterval);
        return;
      }

      if (totalSeconds <= 0) {
        clearInterval(timerInterval);
        timerSpan.textContent = "0:00";
        return;
      }

      totalSeconds--;
      updateDisplay();
    }, 1000);

    function updateDisplay() {
      const mins = Math.floor(totalSeconds / 60);
      const secs = totalSeconds % 60;
      timerSpan.textContent = `${mins}:${secs < 10 ? "0" : ""}${secs}`;
    }
  }

  endgame() {
    this.gameended = true;
    this.toggleSidebar();
    alert("Game has ended");
    this.toggleSidebar();
    this.socket.send(
      JSON.stringify({
        event: "clean_room",
      }),
    );
  }

  finishGame(username) {
    const rows = Array.from(this.elements.leaderboardBody.children);
    const playerRow = rows.find((row) =>
      row.children[1].textContent.includes(username),
    );

    if (playerRow) {
      playerRow.classList.add("completed-player");
    }

    if (username == this.username) {
      this.toggleSidebar();
    }
  }
}

export default MultiplayerGameController;

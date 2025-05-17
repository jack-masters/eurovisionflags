import GameLogic from "./game.js";

class SinglePlayerGameController {
  constructor() {
    this.elements = this.cacheElements();
    this.funwithflags = new GameLogic();
    this.initEventListeners();
    this.gameMode = "MCQ";
  }

  cacheElements() {
    return {
      rangeValue: document.getElementById("range-value"),
      numQuestions: document.getElementById("num-questions"),
      flag: document.getElementById("flag"),
      options: document.getElementById("options"),
      progressMCQ: document.getElementById("progress-mcq"),
      progressMap: document.getElementById("progress-map"),
      errorMessage: document.getElementById("error-message"),
      game: document.getElementById("game"),
      gameModal: document.getElementById("game-modal"),
      finalScore: document.getElementById("final-score"),
      questionModal: document.getElementById("question-modal"),
      startGameBtn: document.getElementById("start-game-btn"),
      gameMCQ: document.getElementById("game-mcq"),
      gameMap: document.getElementById("game-map"),
      flagMap: document.getElementById("flag-map"),
      mapContainer: document.querySelector(".map-container"),
    };
  }

  initEventListeners() {
    this.elements.numQuestions.addEventListener("input", (e) => {
      this.elements.rangeValue.textContent = e.target.value;
    });

    this.elements.startGameBtn.onclick = this.startGame.bind(this);

    document.querySelectorAll('input[name="game-type"]').forEach((radio) => {
      radio.addEventListener("change", (event) => {
        this.gameMode = event.target.value;
      });
    });
  }

  async startGame() {
    const numQuestions = parseInt(this.elements.numQuestions.value);
    const gameType = this.gameMode;

    if (isNaN(numQuestions) || numQuestions <= 0) {
      this.showError("Please enter a valid number of questions.");
      return;
    }

    try {
      this.toggleVisibility(this.elements.questionModal, false);
      this.toggleVisibility(this.elements.game, false);

      const questions = await this.fetchQuestions(numQuestions, gameType);

      if (gameType === "MAP") {
        this.funwithflags.loadMapCSSAndJS(() => {
          this.funwithflags.initializeMap("map");
        });
      }

      this.toggleVisibility(this.elements.game, true);

      this.runGame(questions, gameType);
    } catch {
      this.showError("An error occurred while fetching the game data.");
    }
  }

  async fetchQuestions(numQuestions, gameType) {
    const response = await fetch("/api/singleplayer", {
      method: "GET",
      headers: {
        "X-Num-Questions": numQuestions.toString(),
        "game-type": gameType,
      },
    });
    if (!response.ok) throw new Error("Failed to fetch questions.");
    return response.json();
  }

  runGame(questions, gameType) {
    let currentIndex = 0;
    let score = 0;

    const nextQuestion = (correct) => {
      if (correct) score++;
      if (++currentIndex < questions.length) {
        this.loadQuestion(
          questions[currentIndex],
          currentIndex,
          questions.length,
          nextQuestion,
          gameType,
        );
      } else {
        this.showGameOverModal(score, questions.length);
      }
    };

    this.loadQuestion(
      questions[currentIndex],
      currentIndex,
      questions.length,
      nextQuestion,
      gameType,
    );
  }

  loadQuestion(question, currentIndex, totalQuestions, callback, gameType) {
    if (gameType === "MCQ") {
      this.toggleVisibility(this.elements.gameMCQ, true);
      this.toggleVisibility(this.elements.gameMap, false);

      this.funwithflags.updateProgress(
        this.elements.progressMCQ,
        currentIndex,
        totalQuestions,
      );

      this.funwithflags.loadMCQQuestion(
        this.elements.flag,
        this.elements.options,
        question,
        callback,
        this.funwithflags.handleAnswer,
      );
    } else if (gameType === "MAP") {
      this.toggleVisibility(this.elements.gameMCQ, false);
      this.toggleVisibility(this.elements.gameMap, true);

      this.funwithflags.updateProgress(
        this.elements.progressMap,
        currentIndex,
        totalQuestions,
      );

      this.funwithflags.loadMapQuestion(
        this.elements.gameMap,
        this.elements.flagMap,
        question,
        callback,
      );
    }
  }

  toggleVisibility(element, visible) {
    element.classList.toggle("hidden", !visible);
  }

  showGameOverModal(score, totalQuestions) {
    this.elements.finalScore.textContent = `Your score: ${score}/${totalQuestions}`;
    this.toggleVisibility(this.elements.gameModal, true);
  }

  showError(message) {
    this.elements.errorMessage.textContent = message;
    this.toggleVisibility(this.elements.errorMessage, true);
  }
}

new SinglePlayerGameController();

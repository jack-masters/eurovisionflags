package internals

import (
	"encoding/json"
	"net/http"
	"strconv"
)

func SinglePlayerHandler(w http.ResponseWriter, r *http.Request) {
	numQuestionsStr := r.Header.Get("X-Num-Questions")
	numQuestions, err := strconv.Atoi(numQuestionsStr)
	if err != nil || numQuestions <= 0 {
		http.Error(w, "Invalid number of questions", http.StatusBadRequest)
		return
	}

	gameType := r.Header.Get("game-type")

	questions, err := generateQuestions(numQuestions, gameType)
	if err != nil {
		http.Error(w, "Failed to generate questions: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(questions)
}

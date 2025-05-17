package internals

import (
	"net/http"

	"github.com/gorilla/mux"
)

func Router() *mux.Router {
	r := mux.NewRouter()
	// r.Use(loggingMiddleware)

	// Serve static files under "/static" URL path
	fs := http.FileServer(http.Dir("./frontend/static"))
	r.PathPrefix("/static/").Handler(http.StripPrefix("/static/", fs))

	// WebSocket endpoint for "/ws"
	r.HandleFunc("/ws", HandleWebSocket)

	//
	// Route handlers that serves HTML pages
	//

	// "/"
	r.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "./frontend/index.html")
	})

	// "/"
	r.HandleFunc("/admin", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "./frontend/admin.html")
	})

	// "/joinroom"
	r.HandleFunc("/joinroom", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "./frontend/game.joinroom.html")
	})

	// "/createroom"
	r.HandleFunc("/createroom", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "./frontend/game.createroom.html")
	})

	// "/room?id={id}"
	r.HandleFunc("/room", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "./frontend/game.room.html")
	})

	// "/play" Single player game
	r.HandleFunc("/play", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "./frontend/game.singleplayer.html")
	})

	// "/map" Single player game
	r.HandleFunc("/map", func(w http.ResponseWriter, r *http.Request) {
		http.ServeFile(w, r, "./frontend/worldmap.html")
	})

	// game state
	r.HandleFunc("/api/singleplayer", SinglePlayerHandler).Methods("GET")
	r.HandleFunc("/api/createroom", createRoomHandler).Methods("POST")
	r.HandleFunc("/api/joinroom", joinRoomHandler).Methods("POST")
	r.HandleFunc("/api/room/{id}", getRoomHandler).Methods("GET")
	r.HandleFunc("/api/rooms", adminHandler).Methods("GET")

	//
	// Error handlers
	//

	// 404
	r.NotFoundHandler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
		http.ServeFile(w, r, "./frontend/404.html")
	})

	return r
}

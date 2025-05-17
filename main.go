package main

import (
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/adimail/fun-with-flags/internals"
)

func main() {
	const PORT = 8080
	r := internals.Router()

	go internals.StartRoomCleanup(15 * time.Minute)

	address := fmt.Sprintf(":%d", PORT)
	log.Printf("Server started at %s\n", address)
	if err := http.ListenAndServe(address, r); err != nil {
		log.Fatal("ListenAndServe: ", err)
	}
}

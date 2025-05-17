build:
	@mkdir -p bin
	@go build -o bin/fs main.go

run: build
	@./bin/fs

test:
	@go test ./... -v

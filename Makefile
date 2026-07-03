.PHONY: setup dev build test docker-up docker-down migrate lint clean

setup:
	cd backend && npm install
	cd mobile && npm install

dev:
	cd backend && npm run start:dev

dev-mobile:
	cd mobile && npx expo start

build:
	cd backend && npm run build

test:
	cd backend && npm test

lint:
	cd backend && npm run lint

docker-up:
	docker-compose up -d postgres redis

docker-down:
	docker-compose down

migrate:
	cd backend && npx prisma migrate dev

generate:
	cd backend && npx prisma generate

seed:
	cd backend && npx prisma db seed

clean:
	rm -rf backend/dist backend/node_modules mobile/node_modules

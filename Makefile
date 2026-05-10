BUILD_COUNTER := $(shell cat build_counter.txt)
NEXT_COUNTER  := $(shell echo $$(($(BUILD_COUNTER) + 1)))
VERSION       ?= v1.0.$(NEXT_COUNTER)
IMG           ?= spotiplay:$(VERSION)
APP_NAME      ?= spotiplay
NAMESPACE     ?= spotiplay
PORT          ?= 8000
FORWARD_PORT  ?= 8001
REMOTE_PORT   ?= 8000
PYTHON        ?= python3
VENV          ?= .venv
PIP           ?= $(VENV)/bin/pip
UVICORN       ?= $(VENV)/bin/uvicorn
KUSTOMIZE     ?= kustomize
PYTEST        ?= $(VENV)/bin/pytest

ifndef ignore-not-found
  ignore-not-found = false
endif

.PHONY: help
help:
	@echo "SpotiPlay — comandi disponibili"
	@echo ""
	@echo "  Sviluppo locale:"
	@echo "    make install          Crea .venv e installa le dipendenze"
	@echo "    make dev              Avvia con hot-reload (porta $(PORT))"
	@echo "    make run              Avvia in modalità produzione (porta $(PORT))"
	@echo "    make clean            Rimuove cache Python"
	@echo ""
	@echo "  Container:"
	@echo "    make docker-build     Build immagine Docker ($(IMG))"
	@echo "    make docker-push      Push immagine al registry"
	@echo ""
	@echo "  Minikube:"
	@echo "    make minikube-load    Carica immagine in Minikube (senza registry)"
	@echo "    make deploy           Deploy su K8s via Kustomize"
	@echo "    make undeploy         Rimuove risorse K8s"
	@echo "    make build-n-deploy   docker-build + minikube-load + deploy"
	@echo "    make port-forward     kubectl port-forward $(FORWARD_PORT):$(REMOTE_PORT)"
	@echo ""
	@echo "  Test & Diagnostica:
	@echo "    make install-dev      Installa dipendenze di sviluppo (pytest ecc.)"
	@echo "    make test             Unit test con Spotify mockato (no credenziali)"
	@echo "    make test-integration Integration test con Spotify reale (richiede SPOTIFY_TEST_TOKEN)"
	@echo "    make diagnose         Testa ogni operazione Spotify con il token corrente"
	@echo ""
	@echo "  Changelog & Release:""
	@echo "    make update-unreleased  Aggiorna [Unreleased] in CHANGELOG.md"
	@echo "    make release-status     Mostra stato versione corrente"
	@echo "    make release            Pipeline completa di release"

# ─── Sviluppo locale ──────────────────────────────────────────────────────────

.PHONY: install-dev
install-dev: install
	$(PIP) install -r requirements-dev.txt

.PHONY: install
install:
	@if [ ! -d "$(VENV)" ]; then \
		echo "Creo virtualenv $(VENV)..."; \
		$(PYTHON) -m venv $(VENV); \
	fi
	$(PIP) install --upgrade pip -q
	$(PIP) install -r requirements.txt

.PHONY: dev
dev:
	$(UVICORN) main:app --reload --host 127.0.0.1 --port $(PORT)

.PHONY: run
run:
	$(UVICORN) main:app --host 0.0.0.0 --port $(PORT)

.PHONY: test
test:
	$(PYTEST) tests/test_routes.py -v

.PHONY: test-integration
test-integration:
	$(PYTEST) tests/test_integration.py -v

.PHONY: diagnose
diagnose:
	$(VENV)/bin/python scripts/diagnose.py

.PHONY: clean
clean:
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -name "*.pyc" -o -name "*.pyo" | xargs rm -f 2>/dev/null || true

# ─── Container ────────────────────────────────────────────────────────────────

.PHONY: docker-build
docker-build:
	docker build --no-cache -t $(IMG) .

.PHONY: docker-push
docker-push:
	docker push $(IMG)

# ─── Minikube ─────────────────────────────────────────────────────────────────

.PHONY: minikube-load
minikube-load:
	minikube image load $(IMG)

.PHONY: deploy
deploy:
	cd deploy/kubernetes/$(APP_NAME) && $(KUSTOMIZE) edit set image $(APP_NAME)=$(IMG)
	$(KUSTOMIZE) build deploy/kubernetes/$(APP_NAME) | kubectl apply -f -

.PHONY: undeploy
undeploy:
	$(KUSTOMIZE) build deploy/kubernetes/$(APP_NAME) | kubectl delete --ignore-not-found=$(ignore-not-found) -f -

.PHONY: build-n-deploy
build-n-deploy: docker-build minikube-load deploy

.PHONY: port-forward
port-forward:
	kubectl port-forward -n $(NAMESPACE) svc/$(APP_NAME) $(FORWARD_PORT):$(REMOTE_PORT)

# ─── Changelog ────────────────────────────────────────────────────────────────

.PHONY: update-unreleased
update-unreleased:
	@echo "Aggiornamento sezione [Unreleased] in CHANGELOG.md..."
	@LAST_TAG=$$(git describe --tags --abbrev=0 2>/dev/null || echo ""); \
	if [ -z "$$LAST_TAG" ]; then \
		COMMITS=$$(git log --pretty=format:"%s" 2>/dev/null); \
	else \
		COMMITS=$$(git log $$LAST_TAG..HEAD --pretty=format:"%s"); \
	fi; \
	echo "$$COMMITS" | claude -p \
		"Hai in input i messaggi di commit delle modifiche recenti (uno per riga). \
		Aggiorna solo la sezione [Unreleased] del file CHANGELOG.md aggiungendo le voci pertinenti. \
		NON promuovere a versione numerata, NON modificare sezioni versionate esistenti. \
		Mantieni il formato Keep a Changelog già presente nel file. \
		Non duplicare voci già presenti in [Unreleased]." \
		--allowedTools "Edit(CHANGELOG.md)"

.PHONY: update-changelog
update-changelog:
	@echo "Aggiornamento CHANGELOG.md per $(VERSION)..."
	@LAST_TAG=$$(git describe --tags --abbrev=0 2>/dev/null || echo ""); \
	if [ -z "$$LAST_TAG" ]; then \
		COMMITS=$$(git log --pretty=format:"%s" 2>/dev/null); \
	else \
		COMMITS=$$(git log $$LAST_TAG..HEAD --pretty=format:"%s"); \
	fi; \
	echo "$$COMMITS" | claude -p \
		"Hai in input i messaggi di commit (uno per riga) delle modifiche incluse nella versione $(VERSION) (data odierna: $$(date +%Y-%m-%d)). \
		Aggiorna il file CHANGELOG.md: sposta il contenuto della sezione [Unreleased] sotto una nuova sezione [$(VERSION)] con la data di oggi. \
		Ricrea una sezione [Unreleased] vuota in cima. \
		Mantieni il formato Keep a Changelog già presente nel file. \
		Se un commit è già coperto da [Unreleased] non duplicarlo." \
		--allowedTools "Edit(CHANGELOG.md)"

# ─── Release ──────────────────────────────────────────────────────────────────

.PHONY: release-git
release-git:
	@if [ -z "$(VERSION)" ]; then \
		echo "Errore: VERSION non impostata."; exit 1; \
	fi
	@if git rev-parse "$(VERSION)" >/dev/null 2>&1; then \
		echo "Tag $(VERSION) trovato — tento push se non ancora remoto..."; \
		git push origin HEAD || true; \
		git push --tags || true; \
		exit 0; \
	fi
	$(MAKE) update-changelog VERSION=$(VERSION)
	@echo $(NEXT_COUNTER) > build_counter.txt
	git add build_counter.txt CHANGELOG.md
	git diff --cached --quiet || git commit -m "Release $(VERSION)"
	git tag $(VERSION)
	git push origin HEAD
	git push --tags

.PHONY: release
release: docker-build docker-push release-git

.PHONY: release-status
release-status:
	@echo "=== Release Status ==="
	@echo "Counter su disco : $(BUILD_COUNTER)"
	@echo "VERSION pendente : $(VERSION)"
	@if git rev-parse "$(VERSION)" >/dev/null 2>&1; then \
		echo "Tag locale       : PRESENTE"; \
		if git ls-remote --tags origin "$(VERSION)" 2>/dev/null | grep -q "$(VERSION)"; then \
			echo "Tag remoto       : PUSHATO — release completata"; \
		else \
			echo "Tag remoto       : NON PUSHATO — esegui: git push --tags"; \
		fi; \
	else \
		echo "Tag git          : non ancora creato"; \
	fi

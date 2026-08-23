# Makefile for CmdBar GNOME Extension

UUID = cmdbar@yourdomain.com
EXTENSION_DIR = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

.PHONY: install uninstall test compile-schemas help compile serve dashboard serve-dashboard a11y test-a11y

help:
	@echo "Available commands:"
	@echo "  make install     - Install the extension locally"
	@echo "  make uninstall   - Uninstall the local extension"
	@echo "  make test        - Run the test suite"
	@echo "  make dashboard   - Start Web Dashboard server & drag-and-drop editor"
	@echo "  make a11y        - Run WCAG accessibility compliance audits"
	@echo "  make compile     - Compile public and developer HTML targets"
	@echo "  make serve       - Start local live-reload documentation server"

compile-schemas:
	@echo "Compiling GSettings schemas..."
	glib-compile-schemas extension/schemas/

install: compile-schemas
	@echo "Installing CmdBar extension..."
	mkdir -p $(EXTENSION_DIR)
	cp -r extension/* $(EXTENSION_DIR)/
	@echo "Extension installed successfully to $(EXTENSION_DIR)"
	@echo "Please restart GNOME Shell (Alt+F2 'r' or log out and back in) and enable the extension."

uninstall:
	@echo "Uninstalling CmdBar extension..."
	rm -rf $(EXTENSION_DIR)
	@echo "Extension uninstalled successfully."

test:
	npm run test

dashboard:
	python3 scripts/serve_dashboard.py

serve-dashboard:
	python3 scripts/serve_dashboard.py

compile:
	python3 scripts/compile_docs.py

serve:
	python3 scripts/serve_docs.py

a11y: compile
	npm run test:a11y

test-a11y: compile
	npm run test:a11y

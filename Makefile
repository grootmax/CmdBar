# Makefile for CmdBar GNOME Extension

UUID = cmdbar@yourdomain.com
EXTENSION_DIR = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

PLASMA_PLASMOID_DIR = $(HOME)/.local/share/plasma/plasmoids/org.kde.plasma.cmdbar

.PHONY: install uninstall install-plasma uninstall-plasma test compile-schemas help compile serve a11y test-a11y

help:
	@echo "Available commands:"
	@echo "  make install         - Install the GNOME extension locally"
	@echo "  make install-plasma  - Install the KDE Plasma Plasmoid locally"
	@echo "  make uninstall       - Uninstall the local GNOME extension"
	@echo "  make uninstall-plasma- Uninstall the local KDE Plasma Plasmoid"
	@echo "  make test            - Run the test suite"
	@echo "  make a11y            - Run WCAG accessibility compliance audits"
	@echo "  make compile         - Compile public and developer HTML targets"
	@echo "  make serve           - Start local live-reload documentation server"

compile-schemas:
	@echo "Compiling GSettings schemas..."
	glib-compile-schemas extension/schemas/

install: compile-schemas
	@echo "Installing CmdBar extension..."
	mkdir -p $(EXTENSION_DIR)
	cp -r extension/* $(EXTENSION_DIR)/
	@echo "Extension installed successfully to $(EXTENSION_DIR)"
	@echo "Please restart GNOME Shell (Alt+F2 'r' or log out and back in) and enable the extension."

install-plasma:
	@echo "Installing CmdBar KDE Plasma Plasmoid..."
	mkdir -p $(PLASMA_PLASMOID_DIR)
	cp -r kde-plasma/* $(PLASMA_PLASMOID_DIR)/
	@echo "CmdBar Plasmoid installed successfully to $(PLASMA_PLASMOID_DIR)"
	@echo "You can now add CmdBar to your Plasma panel or system tray from Widget Explorer."

uninstall:
	@echo "Uninstalling CmdBar extension..."
	rm -rf $(EXTENSION_DIR)
	@echo "Extension uninstalled successfully."

uninstall-plasma:
	@echo "Uninstalling CmdBar KDE Plasma Plasmoid..."
	rm -rf $(PLASMA_PLASMOID_DIR)
	@echo "CmdBar Plasmoid uninstalled successfully."

test:
	npm run test

compile:
	python3 scripts/compile_docs.py

serve:
	python3 scripts/serve_docs.py

a11y: compile
	npm run test:a11y

test-a11y: compile
	npm run test:a11y

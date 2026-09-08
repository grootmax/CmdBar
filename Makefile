# Makefile for CmdBar GNOME Extension

UUID = cmdbar@yourdomain.com
EXTENSION_DIR = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

.PHONY: install uninstall install-kde uninstall-kde test compile-schemas help compile serve a11y test-a11y

help:
	@echo "Available commands:"
	@echo "  make install     - Install the GNOME Shell extension locally"
	@echo "  make uninstall   - Uninstall the local GNOME extension"
	@echo "  make install-kde - Install native KDE Plasma Plasmoid extension"
	@echo "  make uninstall-kde - Remove KDE Plasma Plasmoid extension"
	@echo "  make test        - Run the test suite"
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

install-kde:
	@echo "Installing CmdBar KDE Plasma Plasmoid..."
	mkdir -p $(HOME)/.local/share/plasma/plasmoids/org.kde.cmdbar
	cp -r plasma/plasmoids/org.kde.cmdbar/* $(HOME)/.local/share/plasma/plasmoids/org.kde.cmdbar/
	@echo "CmdBar KDE Plasma Plasmoid installed successfully."
	@echo "You can now add CmdBar to your KDE Plasma panel or desktop widgets."

uninstall-kde:
	@echo "Uninstalling CmdBar KDE Plasma Plasmoid..."
	rm -rf $(HOME)/.local/share/plasma/plasmoids/org.kde.cmdbar
	@echo "CmdBar KDE Plasma Plasmoid uninstalled successfully."

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

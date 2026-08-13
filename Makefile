# Makefile for CmdBar GNOME Extension

UUID = cmdbar@yourdomain.com
EXTENSION_DIR = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

.PHONY: install uninstall test help

help:
	@echo "Available commands:"
	@echo "  make install     - Install the extension locally"
	@echo "  make uninstall   - Uninstall the local extension"
	@echo "  make test        - Run the test suite"

install:
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

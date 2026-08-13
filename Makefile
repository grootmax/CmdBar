# Makefile for CmdBar

UUID = cmdbar@yourdomain.com
EXTENSION_DIR = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
CONFIG_DIR = $(HOME)/.config/cmdbar

.PHONY: all install uninstall test run clean help

all: help

help:
	@echo "CmdBar Makefile commands:"
	@echo "  make install     - Install the GNOME Shell Extension to local directory"
	@echo "  make uninstall   - Remove the GNOME Shell Extension"
	@echo "  make test        - Run Python test suite (both config and app logic)"
	@echo "  make run         - Run the Libadwaita companion application"
	@echo "  make clean       - Clean Python caches and bytecodes"

install:
	@echo "Installing GNOME Shell Extension..."
	mkdir -p $(EXTENSION_DIR)
	cp extension/metadata.json $(EXTENSION_DIR)/
	cp extension/extension.js $(EXTENSION_DIR)/
	cp extension/stylesheet.css $(EXTENSION_DIR)/
	@echo "Extension installed to $(EXTENSION_DIR)"
	@echo "To enable, restart GNOME Shell or use extension manager, then enable 'CmdBar'."

uninstall:
	@echo "Removing GNOME Shell Extension..."
	rm -rf $(EXTENSION_DIR)
	@echo "Extension removed."

test:
	@echo "Running test suite..."
	PYTHONPATH=$(PWD) /usr/bin/python3 -m pytest tests/

run:
	@echo "Launching CmdBar Companion App..."
	PYTHONPATH=$(PWD) /usr/bin/python3 app/main.py

clean:
	@echo "Cleaning up..."
	find . -type d -name "__pycache__" -exec rm -rf {} +
	find . -type f -name "*.pyc" -delete

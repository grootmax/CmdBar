.PHONY: install test run-companion-cli run-companion-gui

install:
	@echo "Installing CmdBar GNOME Extension..."
	mkdir -p ~/.local/share/gnome-shell/extensions/cmdbar@yourdomain.com
	cp -r extension/* ~/.local/share/gnome-shell/extensions/cmdbar@yourdomain.com/
	mkdir -p ~/.config/cmdbar
	@if [ ! -f ~/.config/cmdbar/config.json ]; then \
		echo '{"categories": [{"name": "Projects", "commands": [{"name": "Git Checkout", "template": "git checkout {branch}", "parameters": {"branch": {"regex": "^[a-zA-Z0-9_\\\\-/\\\\.]+", "placeholder": "Enter branch name"}}}, {"name": "Docker Logs", "template": "docker logs {container_id}", "parameters": {"container_id": {"placeholder": "Enter container ID"}}}]}]}' > ~/.config/cmdbar/config.json; \
	fi
	@echo "Extension successfully installed. Please restart GNOME Shell (Alt+F2 -> r) and enable the extension."

test:
	PYTHONPATH=/app pytest /app/tests/

run-companion-cli:
	/app/companion/companion_app.py --cli

run-companion-gui:
	/app/companion/companion_app.py

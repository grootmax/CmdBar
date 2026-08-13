UUID = cmdbar@jules.com
DEST = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

.PHONY: install uninstall clean test

install:
	mkdir -p $(DEST)
	cp -r extension/* $(DEST)

uninstall:
	rm -rf $(DEST)

clean:
	@echo "Cleaned"

test:
	node --test test/test_placeholder_logic.js

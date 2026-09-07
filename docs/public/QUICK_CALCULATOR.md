# Quick Calculator & Expression Evaluator

CmdBar features a built-in Quick Calculator and Expression Evaluator directly inside the search box.

## How to Use

Type any of the following prefixes in the CmdBar search box to trigger Calculator Mode:
- Prefix with `>` (e.g. `> 2+2`, `> sin(45)`)
- Prefix with `=` (e.g. `= (100 - 25) / 5`, `= cos(0)`)
- Type `calc ` or `calc` (e.g. `calc 5 * (10 + 2)`, `calc sin(45)`)

## Features

- **Instant Inline Evaluation**: Results are computed live as you type and displayed directly in the dropdown menu.
- **Copy to Clipboard on Enter**: Pressing `Enter` automatically copies the evaluated result to your system clipboard (`wl-copy` on Wayland / `xclip` on X11 / `St.Clipboard`) and closes the menu.
- **Safe Math Evaluation**: Safe math parser supporting arithmetic operators (`+`, `-`, `*`, `/`, `%`, `^`, `**`), parentheses, constants (`pi`, `e`, `tau`, `phi`), implicit multiplication (e.g. `2pi`, `2(3+4)`), and math functions (`sin`, `cos`, `tan`, `sind`, `cosd`, `sqrt`, `abs`, `log`, `floor`, `ceil`, `round`, etc.).

import os
import json
import shutil
import sys
import subprocess
import ast
import re


def ensure_dependencies():
    try:
        import markdown
        import jinja2
    except ImportError:
        print("Installing documentation dependencies (markdown, jinja2)...")
        root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        vendor_candidates = [
            os.path.join(root_dir, "vendor", "python"),
            os.path.join(root_dir, "vendor", "cache", "python"),
            os.path.join(root_dir, "vendor", "wheels"),
        ]
        vendor_dir = None
        for candidate in vendor_candidates:
            if os.path.exists(candidate):
                vendor_dir = candidate
                break

        if vendor_dir:
            print(
                f"Installing dependencies offline from local package cache: {vendor_dir}"
            )
            cmd = [
                sys.executable,
                "-m",
                "pip",
                "install",
                "--no-index",
                "--find-links",
                vendor_dir,
                "markdown",
                "jinja2",
            ]
            try:
                subprocess.check_call(cmd)
            except subprocess.CalledProcessError:
                subprocess.check_call(cmd + ["--user"])
        else:
            try:
                subprocess.check_call(
                    [sys.executable, "-m", "pip", "install", "markdown", "jinja2"]
                )
            except subprocess.CalledProcessError:
                subprocess.check_call(
                    [
                        sys.executable,
                        "-m",
                        "pip",
                        "install",
                        "--user",
                        "markdown",
                        "jinja2",
                    ]
                )


ensure_dependencies()

import markdown
import jinja2


# --- Custom AST-based Python Parser ---
def extract_signature(node):
    args_list = []
    # Positional only args (Python 3.8+)
    if hasattr(node.args, "posonlyargs"):
        for arg in node.args.posonlyargs:
            arg_str = arg.arg
            if arg.annotation:
                arg_str += f": {ast.unparse(arg.annotation).strip()}"
            args_list.append(arg_str)
        if node.args.posonlyargs:
            args_list.append("/")

    # Regular positional/keyword args
    defaults = node.args.defaults
    num_defaults = len(defaults)
    num_args = len(node.args.args)
    for i, arg in enumerate(node.args.args):
        # Skip self or cls for methods to make the API doc cleaner/more standard
        if i == 0 and arg.arg in ("self", "cls"):
            continue
        arg_str = arg.arg
        if arg.annotation:
            arg_str += f": {ast.unparse(arg.annotation).strip()}"
        default_idx = i - (num_args - num_defaults)
        if default_idx >= 0:
            val = ast.unparse(defaults[default_idx]).strip()
            arg_str += f"={val}"
        args_list.append(arg_str)

    # *args
    if node.args.vararg:
        var_str = f"*{node.args.vararg.arg}"
        if node.args.vararg.annotation:
            var_str += f": {ast.unparse(node.args.vararg.annotation).strip()}"
        args_list.append(var_str)

    # Keyword-only args
    kw_defaults = node.args.kw_defaults
    for i, arg in enumerate(node.args.kwonlyargs):
        arg_str = arg.arg
        if arg.annotation:
            arg_str += f": {ast.unparse(arg.annotation).strip()}"
        default_val = kw_defaults[i]
        if default_val is not None:
            val = ast.unparse(default_val).strip()
            arg_str += f"={val}"
        args_list.append(arg_str)

    # **kwargs
    if node.args.kwarg:
        kw_str = f"**{node.args.kwarg.arg}"
        if node.args.kwarg.annotation:
            kw_str += f": {ast.unparse(node.args.kwarg.annotation).strip()}"
        args_list.append(kw_str)

    sig = ", ".join(args_list)
    # returns annotation
    ret_str = ""
    if node.returns:
        ret_str = f" -> {ast.unparse(node.returns).strip()}"

    return f"({sig}){ret_str}"


def check_python_visibility(name, docstring):
    is_explicit_public = False
    if docstring:
        tags = [":visibility: public", "@public", "visibility: public"]
        for tag in tags:
            if tag in docstring:
                is_explicit_public = True
                break

    return "public" if is_explicit_public else "internal"


def parse_python_file(filepath):
    with open(filepath, "r", encoding="utf-8") as f:
        source = f.read()

    try:
        tree = ast.parse(source, filename=filepath)
    except Exception as e:
        print(f"Failed to parse Python file {filepath}: {e}")
        return []

    entities = []

    class Visitor(ast.NodeVisitor):
        def __init__(self):
            self.current_class = None
            self.entities = []

        def visit_ClassDef(self, node):
            docstring = ast.get_docstring(node) or ""
            visibility = check_python_visibility(node.name, docstring)
            self.entities.append(
                {
                    "type": "class",
                    "name": node.name,
                    "class_name": None,
                    "signature": "",
                    "docstring": docstring,
                    "filepath": filepath,
                    "visibility": visibility,
                }
            )

            old_class = self.current_class
            self.current_class = node.name

            # Manually visit children in node.body so they aren't visited by top-level
            for child in node.body:
                self.visit(child)

            self.current_class = old_class

        def visit_FunctionDef(self, node):
            self.handle_function(node)

        def visit_AsyncFunctionDef(self, node):
            self.handle_function(node)

        def handle_function(self, node):
            docstring = ast.get_docstring(node) or ""
            visibility = check_python_visibility(node.name, docstring)
            sig = extract_signature(node)

            self.entities.append(
                {
                    "type": "method" if self.current_class else "function",
                    "name": node.name,
                    "class_name": self.current_class,
                    "signature": sig,
                    "docstring": docstring,
                    "filepath": filepath,
                    "visibility": visibility,
                }
            )

    visitor = Visitor()
    for child in tree.body:
        if isinstance(child, ast.ClassDef):
            visitor.visit(child)
        elif isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
            visitor.visit(child)

    return visitor.entities


# --- Custom JSDoc-based JavaScript Parser ---
def clean_jsdoc(jsdoc_body):
    lines = []
    for line in jsdoc_body.splitlines():
        line = line.strip()
        if line.startswith("*"):
            line = line[1:].strip()
        lines.append(line)
    return "\n".join(lines).strip()


def check_jsdoc_visibility(jsdoc_body):
    if "@public" in jsdoc_body or "@access public" in jsdoc_body:
        return "public"
    return "internal"


def parse_javascript_file(filepath):
    with open(filepath, "r", encoding="utf-8") as f:
        content = f.read()

    entities = []
    declarations = []

    # Classes
    for m in re.finditer(r"\bclass\s+([a-zA-Z0-9_$]+)", content):
        declarations.append(
            {
                "type": "class",
                "name": m.group(1),
                "signature": "",
                "start": m.start(),
                "end": m.end(),
            }
        )

    # Standard functions
    for m in re.finditer(r"\bfunction\s+([a-zA-Z0-9_$]+)\s*\(([^)]*)\)", content):
        declarations.append(
            {
                "type": "function",
                "name": m.group(1),
                "signature": f"({m.group(2).strip()})",
                "start": m.start(),
                "end": m.end(),
            }
        )

    # Arrow functions / const/let/var assignments
    for m in re.finditer(
        r"\b(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>",
        content,
    ):
        declarations.append(
            {
                "type": "function",
                "name": m.group(1),
                "signature": f"({m.group(2).strip()})",
                "start": m.start(),
                "end": m.end(),
            }
        )
    for m in re.finditer(
        r"\b(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?function\s*\(([^)]*)\)",
        content,
    ):
        declarations.append(
            {
                "type": "function",
                "name": m.group(1),
                "signature": f"({m.group(2).strip()})",
                "start": m.start(),
                "end": m.end(),
            }
        )

    # Class methods
    for m in re.finditer(
        r"(?:^|\n)\s*(?:async\s+)?([a-zA-Z0-9_$]+)\s*\(([^)]*)\)\s*\{", content
    ):
        name = m.group(1)
        if name in ("if", "for", "while", "switch", "catch", "with", "function"):
            continue
        declarations.append(
            {
                "type": "method",
                "name": name,
                "signature": f"({m.group(2).strip()})",
                "start": m.start(),
                "end": m.end(),
            }
        )

    declarations.sort(key=lambda d: d["start"])

    for d in declarations:
        prefix = content[: d["start"]]
        docstring = ""
        visibility = "internal"

        doc_start = prefix.rfind("/**")
        matched_jsdoc = False
        if doc_start != -1:
            doc_end = prefix.find("*/", doc_start)
            if doc_end != -1 and doc_end < len(prefix):
                between = prefix[doc_end + 2 :].strip()
                # Clean up whitespace and common keywords
                between_clean = re.sub(
                    r"\b(export|default|async|let|const|var)\b", "", between
                ).strip()
                if not between_clean:
                    jsdoc_body = prefix[doc_start + 3 : doc_end]
                    docstring = clean_jsdoc(jsdoc_body)
                    visibility = check_jsdoc_visibility(jsdoc_body)
                    matched_jsdoc = True

        if not matched_jsdoc:
            m_line = re.search(
                r"((?:\s*//.*?\n)+)\s*(?:export\s+|default\s+|async\s+|let\s+|const\s+|var\s+)*$",
                prefix,
            )
            if m_line:
                lines = []
                for line in m_line.group(1).splitlines():
                    line = line.strip()
                    if line.startswith("//"):
                        line = line[2:].strip()
                    lines.append(line)
                docstring = "\n".join(lines).strip()
                if "@public" in m_line.group(1) or "visibility: public" in m_line.group(
                    1
                ):
                    visibility = "public"

        class_name = None
        if d["type"] == "method":
            parent_class = None
            for prev_d in declarations:
                if prev_d["type"] == "class" and prev_d["start"] < d["start"]:
                    parent_class = prev_d
                elif prev_d["start"] > d["start"]:
                    break
            if parent_class:
                class_name = parent_class["name"]

        entities.append(
            {
                "type": d["type"],
                "name": d["name"],
                "class_name": class_name,
                "signature": d["signature"],
                "docstring": docstring,
                "filepath": filepath,
                "visibility": visibility,
            }
        )

    return entities


def find_and_parse_all_entities():
    all_entities = []

    # 1. Parse Python files
    py_dirs = ["app", "companion"]
    for d in py_dirs:
        if os.path.exists(d):
            for root, dirs, files in os.walk(d):
                for f in files:
                    if f.endswith(".py") and f != "__init__.py":
                        filepath = os.path.join(root, f)
                        all_entities.extend(parse_python_file(filepath))

    # 2. Parse JavaScript files
    js_dirs = ["extension", "companion"]
    for d in js_dirs:
        if os.path.exists(d):
            for root, dirs, files in os.walk(d):
                for f in files:
                    if f.endswith(".js"):
                        filepath = os.path.join(root, f)
                        all_entities.extend(parse_javascript_file(filepath))

    return all_entities


def generate_api_markdown(entities, target_name):
    from collections import defaultdict

    by_file = defaultdict(list)
    for ent in entities:
        by_file[ent["filepath"]].append(ent)

    md = []
    md.append(f"# {target_name.capitalize()} API Reference\n")
    md.append(
        f"Welcome to the **{target_name.capitalize()}** API Reference page. This documentation is automatically extracted from Python and JavaScript source files based on access visibility tags.\n"
    )

    if not by_file:
        md.append(
            "*No public integration APIs found for this target.*"
            if target_name == "public"
            else "*No API entities found.*"
        )
        return "\n".join(md)

    for filepath, file_entities in sorted(by_file.items()):
        md.append(f"## Module: `{filepath}`\n")

        def entity_sort_key(ent):
            type_order = {"class": 0, "function": 1, "method": 2}
            cls_name = ent.get("class_name") or ""
            return (type_order.get(ent["type"], 3), cls_name, ent["name"])

        for ent in sorted(file_entities, key=entity_sort_key):
            name = ent["name"]
            ent_type = ent["type"]
            class_name = ent.get("class_name")
            sig = ent.get("signature") or ""
            docstring = ent.get("docstring") or ""
            visibility = ent["visibility"]

            if ent_type == "class":
                title = f"### Class: `{name}`"
            elif ent_type == "method":
                title = f"### Method: `{class_name}.{name}{sig}`"
            else:
                title = f"### Function: `{name}{sig}`"

            title += f" *({visibility})*"
            md.append(title + "\n")

            if docstring:
                formatted_doc = ""
                for line in docstring.splitlines():
                    formatted_doc += f"> {line}\n"
                md.append(formatted_doc)
            else:
                md.append("> *No description available.*\n")

            md.append("\n")

    return "\n".join(md)


def extract_title(markdown_content, filepath):
    for line in markdown_content.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return os.path.basename(filepath).replace(".md", "").capitalize()


def compile_docs(live_reload=False):
    # Load config
    config_path = "docs/config.json"
    if not os.path.exists(config_path):
        print(f"Error: Configuration file {config_path} not found.")
        sys.exit(1)

    with open(config_path, "r") as f:
        config = json.load(f)

    # Load template
    template_path = "docs/template.html"
    if not os.path.exists(template_path):
        print(f"Error: Template file {template_path} not found.")
        sys.exit(1)

    with open(template_path, "r") as f:
        template_content = f.read()

    jinja_env = jinja2.Environment()
    template = jinja_env.from_string(template_content)

    targets = config.get("targets", {})
    for target_name, target_cfg in targets.items():
        sources = target_cfg.get("sources", [])
        excludes = target_cfg.get("exclude", [])
        output_dir = target_cfg.get("output", f"build/{target_name}")

        print(f"Compiling target '{target_name}' to '{output_dir}'...")

        # Re-create output directory
        if os.path.exists(output_dir):
            shutil.rmtree(output_dir)
        os.makedirs(output_dir, exist_ok=True)

        # Collect all markdown files for this target across all sources
        all_pages = []

        # Convert excludes to full normalized paths for perfect prefix matching
        norm_excludes = [os.path.abspath(ex) for ex in excludes]

        for source in sources:
            if not os.path.exists(source):
                print(f"Warning: Source directory '{source}' not found. Skipping.")
                continue

            for root, dirs, filenames in os.walk(source):
                # Apply exclusions to subdirectories dynamically to prune tree traversal
                pruned_dirs = []
                for d in dirs:
                    d_path = os.path.abspath(os.path.join(root, d))
                    if any(d_path.startswith(ex) for ex in norm_excludes):
                        continue
                    pruned_dirs.append(d)
                dirs[:] = pruned_dirs

                for filename in filenames:
                    if filename.endswith(".md"):
                        full_path = os.path.join(root, filename)
                        abs_full_path = os.path.abspath(full_path)

                        # Double-check file exclusions
                        if any(abs_full_path.startswith(ex) for ex in norm_excludes):
                            continue

                        # Compute relative path from source
                        rel_path_from_src = os.path.relpath(full_path, source)
                        rel_html_path = os.path.splitext(rel_path_from_src)[0] + ".html"

                        with open(full_path, "r", encoding="utf-8") as f_md:
                            content = f_md.read()

                        title = extract_title(content, full_path)
                        all_pages.append(
                            {
                                "filepath": full_path,
                                "source_dir": source,
                                "rel_out_path": rel_html_path,
                                "title": title,
                                "content_md": content,
                            }
                        )

        # Dynamically find, parse, filter, and append the API Reference page
        all_entities = find_and_parse_all_entities()
        if target_name == "public":
            filtered_entities = [
                ent for ent in all_entities if ent["visibility"] == "public"
            ]
        else:
            filtered_entities = all_entities

        api_md = generate_api_markdown(filtered_entities, target_name)
        all_pages.append(
            {
                "filepath": "api.md",
                "source_dir": "docs",
                "rel_out_path": "api.html",
                "title": "API Reference",
                "content_md": api_md,
            }
        )

        # Sort pages for consistent sidebar ordering (index first, then others alphabetically)
        def page_sort_key(p):
            name = os.path.basename(p["rel_out_path"])
            if name == "index.html":
                return (0, name)
            return (1, name)

        all_pages.sort(key=page_sort_key)

        # Compile each page to HTML
        for page in all_pages:
            html_content = markdown.markdown(
                page["content_md"], extensions=["fenced_code", "tables"]
            )

            # Build sidebar links relative to the current page's target folder
            current_dir = os.path.dirname(page["rel_out_path"])
            sidebar_pages = []
            for other in all_pages:
                # Compute relative path from current_dir of this HTML file to target other HTML file
                rel_link = os.path.relpath(other["rel_out_path"], current_dir)
                active = other["rel_out_path"] == page["rel_out_path"]
                sidebar_pages.append(
                    {"title": other["title"], "url": rel_link, "active": active}
                )

            rendered_html = template.render(
                title=page["title"],
                content=html_content,
                sidebar_pages=sidebar_pages,
                live_reload=live_reload,
            )

            out_file_path = os.path.join(output_dir, page["rel_out_path"])
            os.makedirs(os.path.dirname(out_file_path), exist_ok=True)
            with open(out_file_path, "w", encoding="utf-8") as f_out:
                f_out.write(rendered_html)

        print(
            f"Target '{target_name}' compilation complete. {len(all_pages)} files written to '{output_dir}'."
        )


if __name__ == "__main__":
    compile_docs()

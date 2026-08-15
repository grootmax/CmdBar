import os
import json
import shutil
import sys
import subprocess

def ensure_dependencies():
    try:
        import markdown
        import jinja2
    except ImportError:
        print("Installing documentation dependencies (markdown, jinja2)...")
        # Try installing to user package directory, or system wide if possible
        try:
            subprocess.check_call([sys.executable, "-m", "pip", "install", "markdown", "jinja2"])
        except subprocess.CalledProcessError:
            subprocess.check_call([sys.executable, "-m", "pip", "install", "--user", "markdown", "jinja2"])

ensure_dependencies()

import markdown
import jinja2

def extract_title(markdown_content, filepath):
    for line in markdown_content.splitlines():
        if line.startswith('# '):
            return line[2:].strip()
    return os.path.basename(filepath).replace('.md', '').capitalize()

def compile_docs(live_reload=False):
    # Load config
    config_path = 'docs/config.json'
    if not os.path.exists(config_path):
        print(f"Error: Configuration file {config_path} not found.")
        sys.exit(1)

    with open(config_path, 'r') as f:
        config = json.load(f)

    # Load template
    template_path = 'docs/template.html'
    if not os.path.exists(template_path):
        print(f"Error: Template file {template_path} not found.")
        sys.exit(1)

    with open(template_path, 'r') as f:
        template_content = f.read()

    jinja_env = jinja2.Environment()
    template = jinja_env.from_string(template_content)

    targets = config.get('targets', {})
    for target_name, target_cfg in targets.items():
        sources = target_cfg.get('sources', [])
        excludes = target_cfg.get('exclude', [])
        output_dir = target_cfg.get('output', f'build/{target_name}')

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
                    if filename.endswith('.md'):
                        full_path = os.path.join(root, filename)
                        abs_full_path = os.path.abspath(full_path)
                        
                        # Double-check file exclusions
                        if any(abs_full_path.startswith(ex) for ex in norm_excludes):
                            continue

                        # Compute relative path from source
                        rel_path_from_src = os.path.relpath(full_path, source)
                        rel_html_path = os.path.splitext(rel_path_from_src)[0] + '.html'

                        with open(full_path, 'r', encoding='utf-8') as f_md:
                            content = f_md.read()
                        
                        title = extract_title(content, full_path)
                        all_pages.append({
                            "filepath": full_path,
                            "source_dir": source,
                            "rel_out_path": rel_html_path,
                            "title": title,
                            "content_md": content
                        })

        # Sort pages for consistent sidebar ordering (index first, then others alphabetically)
        def page_sort_key(p):
            name = os.path.basename(p["rel_out_path"])
            if name == 'index.html':
                return (0, name)
            return (1, name)
            
        all_pages.sort(key=page_sort_key)

        # Compile each page to HTML
        for page in all_pages:
            html_content = markdown.markdown(
                page["content_md"],
                extensions=['fenced_code', 'tables']
            )

            # Build sidebar links relative to the current page's target folder
            current_dir = os.path.dirname(page["rel_out_path"])
            sidebar_pages = []
            for other in all_pages:
                # Compute relative path from current_dir of this HTML file to target other HTML file
                rel_link = os.path.relpath(other["rel_out_path"], current_dir)
                active = (other["rel_out_path"] == page["rel_out_path"])
                sidebar_pages.append({
                    "title": other["title"],
                    "url": rel_link,
                    "active": active
                })

            rendered_html = template.render(
                title=page["title"],
                content=html_content,
                sidebar_pages=sidebar_pages,
                live_reload=live_reload
            )

            out_file_path = os.path.join(output_dir, page["rel_out_path"])
            os.makedirs(os.path.dirname(out_file_path), exist_ok=True)
            with open(out_file_path, 'w', encoding='utf-8') as f_out:
                f_out.write(rendered_html)

        print(f"Target '{target_name}' compilation complete. {len(all_pages)} files written to '{output_dir}'.")

if __name__ == '__main__':
    compile_docs()

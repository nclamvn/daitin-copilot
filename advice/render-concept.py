"""Build the portable M9 concept with synthetic sources only."""

import base64
import re
import sys
from pathlib import Path

project = Path(__file__).resolve().parent.parent
advice = project / "advice"


def as_script(path):
    return re.sub(r"^export ", "", path.read_text(), flags=re.MULTILINE)


destination = Path(sys.argv[1])
logo_file = Path(sys.argv[2]) if len(sys.argv) > 2 else project / "public/brand/daitin.png"
logo = "data:image/png;base64," + base64.b64encode(logo_file.read_bytes()).decode()
css = (project / "public/fonts.css").read_text() + "\n" + (advice / "ui/app.css").read_text()
module = "\n".join([
    as_script(advice / "engine.mjs"),
    as_script(advice / "demo.mjs"),
    """globalThis.daitinAdvicePreview = {
      config: { label: 'Concept · Dữ liệu mô phỏng', prompts, scenarios },
      initialQuestion: prompts[0],
      ask: ({ query, scenario }) => answerAdvice(query, demoWord, simulatedMail, scenario, true),
    };""",
    as_script(advice / "ui/app.mjs"),
])
html = (advice / "ui/index.html").read_text()
html = html.replace('  <link rel="stylesheet" href="/public/fonts.css">\n', '')
html = html.replace('<link rel="stylesheet" href="/advice/app.css">', '<style>' + css + '</style>')
html = html.replace('/public/brand/daitin.png', logo).replace('href="/advice/"', 'href="#"')
html = html.replace('<script type="module" src="/advice/app.mjs"></script>', '<script type="module">' + module + '</script>')
destination.write_text(html)

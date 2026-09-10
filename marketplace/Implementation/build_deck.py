#!/usr/bin/env python3
"""Build 'Marketplace Onboarding — from app to live tile' deck.

Runs inside python:3.12-slim with python-pptx installed (see build-deck.sh).
All diagrams are native PPTX shapes (crisp, editable, on-brand) — no images.
Reuses the house helper/palette from ../../presentation/build_deck.py.
"""
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE, MSO_CONNECTOR
from pptx.oxml.ns import qn

# ---- brand palette (matches the house deck) --------------------------------
NAVY  = RGBColor(0x0A, 0x1F, 0x44)
BLUE  = RGBColor(0x1E, 0x5E, 0xD6)
TEAL  = RGBColor(0x17, 0xB0, 0xA6)
GREEN = RGBColor(0x2E, 0xA8, 0x55)
AMBER = RGBColor(0xE8, 0x9A, 0x1C)
RED   = RGBColor(0xC0, 0x39, 0x2B)
SLATE = RGBColor(0x33, 0x3F, 0x52)
GREY  = RGBColor(0x6B, 0x76, 0x88)
LIGHT = RGBColor(0xF2, 0xF5, 0xFA)
CARD  = RGBColor(0xFF, 0xFF, 0xFF)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
LINE  = RGBColor(0xD3, 0xDA, 0xE6)

EMU_W, EMU_H = Inches(13.333), Inches(7.5)
FONT = "Segoe UI"

prs = Presentation()
prs.slide_width, prs.slide_height = EMU_W, EMU_H
BLANK = prs.slide_layouts[6]

# ---- helpers (ported from presentation/build_deck.py) ----------------------
def slide():
    return prs.slides.add_slide(BLANK)

def _fill(shp, c):
    shp.fill.solid(); shp.fill.fore_color.rgb = c
def _noline(shp):
    shp.line.fill.background()
def _line(shp, c, w=1.0):
    shp.line.color.rgb = c; shp.line.width = Pt(w)

def bg(s, c=WHITE):
    r = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, EMU_W, EMU_H)
    _fill(r, c); _noline(r); r.shadow.inherit = False
    return r

def band(s, x, y, w, h, c):
    r = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, x, y, w, h)
    _fill(r, c); _noline(r); r.shadow.inherit = False
    return r

def txt(s, x, y, w, h, runs, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, wrap=True):
    tb = s.shapes.add_textbox(x, y, w, h); tf = tb.text_frame
    tf.word_wrap = wrap; tf.vertical_anchor = anchor
    tf.margin_left = tf.margin_right = Pt(2); tf.margin_top = tf.margin_bottom = Pt(1)
    if isinstance(runs, tuple):
        runs = [runs]
    first = True
    for text, size, color, bold in runs:
        p = tf.paragraphs[0] if first else tf.add_paragraph()
        p.alignment = align; first = False
        for i, part in enumerate(text.split("\n")):
            if i > 0:
                p = tf.add_paragraph(); p.alignment = align
            r = p.add_run(); r.text = part
            r.font.size = Pt(size); r.font.bold = bold
            r.font.color.rgb = color; r.font.name = FONT
    return tb

def bullets(s, x, y, w, h, items, size=15, color=SLATE, gap=7, marker="▸ ", mcolor=BLUE):
    tb = s.shapes.add_textbox(x, y, w, h); tf = tb.text_frame; tf.word_wrap = True
    for i, it in enumerate(items):
        if isinstance(it, tuple):
            text, indent, bold, c = (it + (0, False, color))[:4]
        else:
            text, indent, bold, c = it, 0, False, color
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.space_after = Pt(gap); p.level = indent
        if indent == 0:
            rm = p.add_run(); rm.text = marker
            rm.font.size = Pt(size); rm.font.bold = True
            rm.font.color.rgb = mcolor; rm.font.name = FONT
        r = p.add_run(); r.text = text
        r.font.size = Pt(size - indent); r.font.bold = bold
        r.font.color.rgb = c; r.font.name = FONT
    return tb

def _soft_shadow(shp):
    sp = shp._element.spPr
    eff = sp.makeelement(qn('a:effectLst'), {})
    sh = sp.makeelement(qn('a:outerShdw'),
        {'blurRad': '60000', 'dist': '25000', 'dir': '5400000', 'rotWithShape': '0'})
    clr = sp.makeelement(qn('a:srgbClr'), {'val': '0A1F44'})
    a = sp.makeelement(qn('a:alpha'), {'val': '22000'})
    clr.append(a); sh.append(clr); eff.append(sh); sp.append(eff)

def card(s, x, y, w, h, fill=CARD, line=LINE, lw=1.0, radius=True, shadow=True):
    t = MSO_SHAPE.ROUNDED_RECTANGLE if radius else MSO_SHAPE.RECTANGLE
    r = s.shapes.add_shape(t, x, y, w, h)
    _fill(r, fill); _line(r, line, lw)
    if radius:
        try: r.adjustments[0] = 0.06
        except Exception: pass
    r.shadow.inherit = False
    if shadow: _soft_shadow(r)
    return r

def pill(s, x, y, w, h, text, fill, tcolor=WHITE, size=12, bold=True):
    r = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x, y, w, h)
    _fill(r, fill); _noline(r); r.shadow.inherit = False
    try: r.adjustments[0] = 0.5
    except Exception: pass
    tf = r.text_frame; tf.word_wrap = False
    tf.margin_top = tf.margin_bottom = Pt(0); tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER
    rn = p.add_run(); rn.text = text
    rn.font.size = Pt(size); rn.font.bold = bold
    rn.font.color.rgb = tcolor; rn.font.name = FONT
    return r

def boxlabel(s, x, y, w, h, title, sub=None, fill=CARD, line=BLUE, tcolor=NAVY,
             tsize=13, ssize=10, lw=1.5, subcolor=GREY):
    r = card(s, x, y, w, h, fill=fill, line=line, lw=lw, shadow=True)
    tf = r.text_frame; tf.word_wrap = True; tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    tf.margin_left = tf.margin_right = Pt(6)
    p = tf.paragraphs[0]; p.alignment = PP_ALIGN.CENTER
    rn = p.add_run(); rn.text = title
    rn.font.size = Pt(tsize); rn.font.bold = True
    rn.font.color.rgb = tcolor; rn.font.name = FONT
    if sub:
        p2 = tf.add_paragraph(); p2.alignment = PP_ALIGN.CENTER
        rn2 = p2.add_run(); rn2.text = sub
        rn2.font.size = Pt(ssize); rn2.font.color.rgb = subcolor; rn2.font.name = FONT
    return r

def arrow(s, x1, y1, x2, y2, color=BLUE, w=2.0, dash=None):
    cn = s.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, x1, y1, x2, y2)
    cn.line.color.rgb = color; cn.line.width = Pt(w)
    le = cn.line._get_or_add_ln()
    le.append(le.makeelement(qn('a:tailEnd'), {'type': 'triangle', 'w': 'med', 'len': 'med'}))
    if dash:
        le.insert(0, le.makeelement(qn('a:prstDash'), {'val': dash}))
    cn.shadow.inherit = False
    return cn

def title_header(s, kicker, title, n=None):
    band(s, 0, 0, EMU_W, Inches(1.32), NAVY)
    band(s, 0, Inches(1.32), EMU_W, Pt(3), TEAL)
    if n is not None:
        pill(s, Inches(0.55), Inches(0.4), Inches(0.55), Inches(0.48), str(n), TEAL, WHITE, size=16)
        tx = Inches(1.3)
    else:
        tx = Inches(0.55)
    txt(s, tx, Inches(0.14), Inches(12.2), Inches(0.32), (kicker.upper(), 12, TEAL, True))
    txt(s, tx, Inches(0.42), Inches(12.2), Inches(0.82), (title, 24, WHITE, True))

def footer(s, idx):
    txt(s, Inches(0.5), Inches(7.06), Inches(10), Inches(0.3),
        ("AI Trust Platform  ·  Marketplace onboarding", 9, GREY, False))
    txt(s, Inches(12.2), Inches(7.06), Inches(0.9), Inches(0.3),
        (str(idx), 9, GREY, True), align=PP_ALIGN.RIGHT)

# =====================================================================
# 1 — TITLE
# =====================================================================
s = slide(); bg(s, NAVY)
band(s, 0, Inches(3.05), EMU_W, Pt(3), TEAL)
txt(s, Inches(0.9), Inches(1.6), Inches(11.5), Inches(0.5),
    ("SAP AI TRUST PLATFORM", 15, TEAL, True))
txt(s, Inches(0.9), Inches(2.1), Inches(11.5), Inches(1.4),
    ("Onboarding an app into the Marketplace", 40, WHITE, True))
txt(s, Inches(0.9), Inches(3.3), Inches(11.5), Inches(0.9),
    ("From a plain web app to a live, single-sign-on, role-gated tile —\nwith no changes to the app's code.",
     18, RGBColor(0xC9, 0xD4, 0xE8), False))
pill(s, Inches(0.9), Inches(4.7), Inches(3.1), Inches(0.5), "APP SIDE  →  PLATFORM SIDE", BLUE, WHITE, size=12)
txt(s, Inches(0.9), Inches(6.7), Inches(11), Inches(0.4),
    ("For product & technical audiences  ·  see marketplace/Implementation/ for the full guide", 11, GREY, False))

# =====================================================================
# 2 — WHY / THE PROBLEM
# =====================================================================
s = slide(); bg(s, WHITE); title_header(s, "The problem", "What onboarding gives you", 1)
txt(s, Inches(0.6), Inches(1.6), Inches(12), Inches(0.5),
    ("You have a web app. You want it inside the platform — without rebuilding auth or hosting.", 16, SLATE, False))
cols = [
    ("Single Sign-On", "Users are already logged into the platform. The app should just trust that — no second login.", TEAL),
    ("Role-based access", "Only the right people can see and open it. Hidden and blocked otherwise.", BLUE),
    ("Embedded tile", "Appears in the sidebar under Services and opens right there — not a separate website.", GREEN),
]
x = Inches(0.6)
for name, desc, c in cols:
    card(s, x, Inches(2.4), Inches(3.9), Inches(2.6), fill=LIGHT, line=c, lw=2)
    band(s, x + Inches(0.35), Inches(2.75), Inches(0.5), Pt(5), c)
    txt(s, x + Inches(0.35), Inches(2.95), Inches(3.3), Inches(0.5), (name, 18, NAVY, True))
    txt(s, x + Inches(0.35), Inches(3.55), Inches(3.3), Inches(1.3), (desc, 13, SLATE, False))
    x += Inches(4.13)
card(s, Inches(0.6), Inches(5.35), Inches(12.1), Inches(1.15), fill=NAVY, line=NAVY, shadow=False)
txt(s, Inches(0.9), Inches(5.5), Inches(11.6), Inches(0.85),
    [("The platform does all three for you. ", 15, WHITE, True),
     ("You wrap the app once (no code changes), publish it as an image, then register + deploy + enable it.", 15, RGBColor(0xC9,0xD4,0xE8), False)],
    anchor=MSO_ANCHOR.MIDDLE)
footer(s, 2)

# =====================================================================
# 3 — THE TWO HALVES + END-TO-END FLOW
# =====================================================================
s = slide(); bg(s, WHITE); title_header(s, "The whole flow", "Two halves, six steps", 2)
# app side band
card(s, Inches(0.6), Inches(1.7), Inches(12.1), Inches(2.05), fill=LIGHT, line=TEAL, lw=1.5)
txt(s, Inches(0.8), Inches(1.8), Inches(11), Inches(0.35), ("APPLICATION SIDE  ·  the app's developer, once", 12, TEAL, True))
steps_app = [("1 · Patch", "run prepare-app\n→ adds sidecar\n(no code change)"),
             ("2 · Push", "push branch\n→ GitHub Actions\nbuilds the image"),
             ("→ GHCR", "ghcr.io/<owner>/\n<repo>:sso")]
x = Inches(0.9)
for i, (t, d) in enumerate(steps_app):
    boxlabel(s, x, Inches(2.35), Inches(3.2), Inches(1.15), t, d, line=(GREEN if i == 2 else TEAL))
    if i < 2:
        arrow(s, x + Inches(3.2), Inches(2.92), x + Inches(3.75), Inches(2.92), color=TEAL)
    x += Inches(3.75)
# platform side band
card(s, Inches(0.6), Inches(3.95), Inches(12.1), Inches(2.5), fill=LIGHT, line=BLUE, lw=1.5)
txt(s, Inches(0.8), Inches(4.05), Inches(11), Inches(0.35), ("PLATFORM SIDE  ·  a Platform Administrator", 12, BLUE, True))
steps_plat = [("3 · Register", "Add-a-service form:\nimage, port 8080,\nPlatform SSO ✅"),
              ("4 · Deploy", "platform pulls image,\nmints OIDC client,\ninjects login env"),
              ("5 · Enable", "pick the role(s)\n→ tile appears\nunder Services"),
              ("6 · Use", "click tile → already\nlogged in → opens\nembedded")]
x = Inches(0.85)
for i, (t, d) in enumerate(steps_plat):
    boxlabel(s, x, Inches(4.65), Inches(2.75), Inches(1.5), t, d, line=BLUE)
    if i < 3:
        arrow(s, x + Inches(2.75), Inches(5.4), x + Inches(2.95), Inches(5.4), color=BLUE)
    x += Inches(2.95)
footer(s, 3)

# =====================================================================
# 4 — APPLICATION PATCH (prepare-app + sidecar)
# =====================================================================
s = slide(); bg(s, WHITE); title_header(s, "Application side", "The patch: prepare-app + sidecar", 3)
txt(s, Inches(0.6), Inches(1.55), Inches(12), Inches(0.5),
    ("One script. It ADDS files — it never edits your app's code.", 16, SLATE, True))
bullets(s, Inches(0.6), Inches(2.2), Inches(6.0), Inches(4.4), [
    ("What it generates in your repo:", 0, True, NAVY),
    (".platform-sso/sidecar/  — the OIDC-login proxy", 1, False, SLATE),
    (".platform-sso/entrypoint.sh  — runs app + sidecar", 1, False, SLATE),
    ("Dockerfile.platform-sso  — wraps your image", 1, False, SLATE),
    (".github/workflows/publish-image.yml  — CI build", 1, False, SLATE),
    ("ui_deploy_guide.md + trust_platform_update.md", 1, False, SLATE),
    ("Your original Dockerfile & source: untouched.", 0, True, GREEN),
    ("Ports:  register 8080 (sidecar)  ·  app runs 3000 inside", 0, True, AMBER),
], size=14)
# mini diagram of the container
card(s, Inches(6.9), Inches(2.2), Inches(5.8), Inches(4.2), fill=LIGHT, line=LINE)
txt(s, Inches(7.1), Inches(2.35), Inches(5.4), Inches(0.4), ("Inside the container", 13, NAVY, True))
boxlabel(s, Inches(7.2), Inches(2.9), Inches(5.2), Inches(0.95), "Platform-SSO sidecar  :8080",
         "does the login, then forwards", line=TEAL)
arrow(s, Inches(9.8), Inches(3.85), Inches(9.8), Inches(4.4), color=SLATE)
boxlabel(s, Inches(7.2), Inches(4.4), Inches(5.2), Inches(0.95), "Your app  :3000",
         "unchanged — any language", line=BLUE)
txt(s, Inches(7.2), Inches(5.55), Inches(5.2), Inches(0.8),
    ("The platform talks only to :8080. The app is never exposed directly.", 12, GREY, False))
footer(s, 4)

# =====================================================================
# 5 — PUBLISH (push → CI → GHCR)
# =====================================================================
s = slide(); bg(s, WHITE); title_header(s, "Application side", "Publish: push → CI → image", 4)
row_y = Inches(2.6)
boxlabel(s, Inches(0.7), row_y, Inches(3.0), Inches(1.2), "git push", "branch: platform-sso", line=TEAL)
arrow(s, Inches(3.7), row_y + Inches(0.6), Inches(4.25), row_y + Inches(0.6), color=SLATE)
boxlabel(s, Inches(4.25), row_y, Inches(4.3), Inches(1.2), "GitHub Actions: publish-image",
         "build Dockerfile.platform-sso", line=BLUE)
arrow(s, Inches(8.55), row_y + Inches(0.6), Inches(9.1), row_y + Inches(0.6), color=SLATE)
boxlabel(s, Inches(9.1), row_y, Inches(3.5), Inches(1.2), "GHCR", "ghcr.io/<owner>/<repo>:sso", line=GREEN)
bullets(s, Inches(0.7), Inches(4.3), Inches(11.8), Inches(2.2), [
    ("One-time repo setting: Settings → Actions → Workflow permissions → Read and write", 0, True, AMBER),
    ("Package is private by default → supply a read:packages token at Deploy (or make it public)", 0, False, SLATE),
    ("Confirm: green Actions run + the package shows the ':sso' tag", 0, False, SLATE),
], size=15)
footer(s, 5)

# =====================================================================
# 6 — PLATFORM: what happens behind the scenes on Deploy
# =====================================================================
s = slide(); bg(s, WHITE); title_header(s, "Platform side", "Deploy — behind the scenes", 5)
txt(s, Inches(0.6), Inches(1.55), Inches(12), Inches(0.4),
    ("You click Deploy (with Platform SSO ✅). The platform automatically:", 16, SLATE, True))
items = [
    ("1", "Mints an OIDC login client", "aitrust-app-<slug> in Keycloak"),
    ("2", "Injects the login settings", "OIDC_ISSUER / CLIENT_ID / REDIRECT_URI / SCOPES + secret"),
    ("3", "Pulls & runs the image", "using your registry token if private (never stored)"),
    ("4", "Serves it via the embed proxy", "…/api/marketplace/v1/proxy/<slug>/ — same origin, iframe"),
]
y = Inches(2.2)
for n, t, d in items:
    pill(s, Inches(0.7), y + Inches(0.12), Inches(0.5), Inches(0.5), n, BLUE, WHITE, size=15)
    card(s, Inches(1.4), y, Inches(11.3), Inches(0.95), fill=LIGHT, line=LINE)
    txt(s, Inches(1.7), y + Inches(0.11), Inches(4.6), Inches(0.7), (t, 15, NAVY, True), anchor=MSO_ANCHOR.MIDDLE)
    txt(s, Inches(6.2), y + Inches(0.11), Inches(6.3), Inches(0.7), (d, 13, SLATE, False), anchor=MSO_ANCHOR.MIDDLE)
    y += Inches(1.08)
txt(s, Inches(0.7), Inches(6.7), Inches(12), Inches(0.4),
    ("Nothing is minted or deployed at Register time — only when you Deploy.", 12, GREY, False))
footer(s, 6)

# =====================================================================
# 7 — ENABLE FOR ROLE + USE (the request flow)
# =====================================================================
s = slide(); bg(s, WHITE); title_header(s, "Platform side", "Enable for a role, then use it", 6)
bullets(s, Inches(0.6), Inches(1.7), Inches(5.9), Inches(2.4), [
    ("Enable for role → the tile appears", 0, True, NAVY),
    ("Stored in the platform's own database", 1, False, SLATE),
    ("The same check is re-enforced at the proxy (403 if not allowed)", 1, False, SLATE),
    ("Hidden & blocked until enabled", 1, False, SLATE),
], size=15)
# request flow diagram
card(s, Inches(6.7), Inches(1.7), Inches(6.0), Inches(4.6), fill=LIGHT, line=LINE)
txt(s, Inches(6.9), Inches(1.82), Inches(5.6), Inches(0.35), ("One click, behind the scenes", 13, NAVY, True))
flow = [("Browser", "clicks the tile", BLUE),
        ("Platform proxy", "strips prefix · checks role", TEAL),
        ("Sidecar :8080", "logs in (or forwards)", TEAL),
        ("Your app :3000", "serves the page, unchanged", GREEN)]
y = Inches(2.3)
for i, (t, d, c) in enumerate(flow):
    boxlabel(s, Inches(7.0), y, Inches(5.4), Inches(0.78), t, d, line=c, tsize=13, ssize=10)
    if i < 3:
        arrow(s, Inches(9.7), y + Inches(0.78), Inches(9.7), y + Inches(0.98), color=SLATE)
    y += Inches(0.98)
txt(s, Inches(0.6), Inches(4.6), Inches(5.9), Inches(1.7),
    [("Result: ", 15, GREEN, True),
     ("the user opens the tile and is already logged in — one platform login, embedded, role-gated.",
      15, SLATE, False)])
footer(s, 7)

# =====================================================================
# 8 — MULTI-TENANT REALM NOTE (the caveat)
# =====================================================================
s = slide(); bg(s, WHITE); title_header(s, "Advanced · operators", "Multi-tenant: match the realm", 7)
card(s, Inches(0.6), Inches(1.7), Inches(12.1), Inches(1.15), fill=RGBColor(0xFD,0xF3,0xE2), line=AMBER, lw=1.5)
txt(s, Inches(0.9), Inches(1.85), Inches(11.6), Inches(0.9),
    [("On a multi-tenant mesh you log in against a PER-TENANT realm (e.g. ", 14, SLATE, False),
     ("test", 14, NAVY, True),
     ("), not the built-in ", 14, SLATE, False),
     ("ai-trust", 14, NAVY, True),
     (" realm.", 14, SLATE, False)], anchor=MSO_ANCHOR.MIDDLE)
# mismatch table
headers = ["", "Your login", "SSO deploy (default)"]
rows = [("Keycloak", "mesh", "local (tenant ns)"),
        ("Realm", "<org>  e.g. test", "ai-trust"),
        ("Result", "your session", "→ different realm → SSO fails")]
tx, ty, cw = Inches(0.6), Inches(3.1), [Inches(2.2), Inches(4.6), Inches(5.3)]
band(s, tx, ty, sum(cw, Inches(0)), Inches(0.5), NAVY)
cx = tx
for i, hdr in enumerate(headers):
    txt(s, cx + Inches(0.15), ty + Inches(0.06), cw[i], Inches(0.4), (hdr, 12, WHITE, True))
    cx += cw[i]
for r, (a, b, c) in enumerate(rows):
    yy = ty + Inches(0.5) + r * Inches(0.55)
    band(s, tx, yy, sum(cw, Inches(0)), Inches(0.55), LIGHT if r % 2 == 0 else WHITE)
    vals = [a, b, c]; cx = tx
    for i, v in enumerate(vals):
        col = NAVY if i == 0 else (SLATE if i == 1 else RED if r == 2 else SLATE)
        txt(s, cx + Inches(0.15), yy + Inches(0.08), cw[i], Inches(0.4),
            (v, 12, col, i == 0), anchor=MSO_ANCHOR.MIDDLE)
        cx += cw[i]
txt(s, Inches(0.6), Inches(5.55), Inches(12.1), Inches(1.0),
    [("Fix: ", 14, GREEN, True),
     ("point marketplace-backend at the mesh Keycloak + KEYCLOAK_REALM=<org> + mesh admin creds "
      "(one env override) before deploying an SSO app. See 05-multitenant-mesh-notes.md.",
      14, SLATE, False)])
footer(s, 8)

# =====================================================================
# 9 — TWO KINDS OF APP (the decision that matters)
# =====================================================================
s = slide(); bg(s, WHITE); title_header(s, "Decision", "Two kinds of app — two paths", 9)
txt(s, Inches(0.6), Inches(1.55), Inches(12), Inches(0.4),
    ("Does your app already do its OWN login (OIDC)? That decides how it's onboarded.", 16, SLATE, True))
# left card: no own auth → sidecar
card(s, Inches(0.6), Inches(2.3), Inches(5.9), Inches(4.0), fill=LIGHT, line=TEAL, lw=2)
txt(s, Inches(0.9), Inches(2.5), Inches(5.3), Inches(0.5), ("APP HAS NO AUTH OF ITS OWN", 13, TEAL, True))
bullets(s, Inches(0.9), Inches(3.05), Inches(5.3), Inches(3.1), [
    ("Use the Platform-SSO sidecar", 0, True, NAVY),
    "prepare-app wraps it (no code change)",
    "Platform SSO ✅, App port 8080",
    "The sidecar does the login + forwards identity",
    "Single platform login — just works",
], size=14, mcolor=TEAL)
# right card: own OIDC → trust platform JWT
card(s, Inches(6.8), Inches(2.3), Inches(5.9), Inches(4.0), fill=LIGHT, line=AMBER, lw=2)
txt(s, Inches(7.1), Inches(2.5), Inches(5.3), Inches(0.5), ("APP ALREADY DOES ITS OWN OIDC", 13, AMBER, True))
bullets(s, Inches(7.1), Inches(3.05), Inches(5.3), Inches(3.1), [
    ("Do NOT stack the sidecar", 0, True, RED),
    "Two logins collide → loop / 500",
    "Deploy the app plain, Platform SSO OFF",
    "App trusts the platform JWT (preferred_username)",
    "and skips its own login → single login",
], size=14, mcolor=AMBER)
footer(s, 9)

# =====================================================================
# 10 — LESSONS FROM A REAL RUN (worked example)
# =====================================================================
s = slide(); bg(s, WHITE); title_header(s, "Worked example", "Lessons from a real onboarding", 10)
txt(s, Inches(0.6), Inches(1.55), Inches(12), Inches(0.4),
    ("EU Capitals Weather onto the ai-trust-test tenant — what tripped us, and the fix.", 15, SLATE, True))
lessons = [
    ("Build amd64", "A Mac-built (arm64) image → ErrImagePull \"no match for platform\". Use buildx --platform linux/amd64."),
    ("Match the tenant host", "APP_PUBLIC_URL + Keycloak redirect URIs must be the tenant host (realm test), not the shared host → else redirect loop."),
    ("Identity = JWT here", "The tenant proxy forwards identity as Authorization: Bearer, NOT X-Forwarded-* . Read the JWT's preferred_username."),
    ("Prefix-aware frontend", "Root-absolute fetch(\"/api/…\") escapes the embed prefix → blank page. Derive the base from the path."),
]
y = Inches(2.15)
for t, d in lessons:
    card(s, Inches(0.6), y, Inches(12.1), Inches(0.95), fill=LIGHT, line=LINE)
    txt(s, Inches(0.9), y + Inches(0.1), Inches(3.4), Inches(0.75), (t, 14, NAVY, True), anchor=MSO_ANCHOR.MIDDLE)
    txt(s, Inches(4.3), y + Inches(0.1), Inches(8.2), Inches(0.75), (d, 12, SLATE, False), anchor=MSO_ANCHOR.MIDDLE)
    y += Inches(1.05)
txt(s, Inches(0.6), Inches(6.6), Inches(12), Inches(0.4),
    ("Full story: 08-worked-example-weather-app.md", 12, GREY, False))
footer(s, 10)

# =====================================================================
# 11 — WHO DOES WHAT (summary)
# =====================================================================
s = slide(); bg(s, WHITE); title_header(s, "Summary", "Who does what", 11)
card(s, Inches(0.6), Inches(1.8), Inches(5.9), Inches(4.5), fill=LIGHT, line=TEAL, lw=1.5)
txt(s, Inches(0.9), Inches(1.95), Inches(5.3), Inches(0.4), ("APP DEVELOPER  ·  once", 13, TEAL, True))
bullets(s, Inches(0.9), Inches(2.5), Inches(5.3), Inches(3.6), [
    "Run prepare-app against the repo",
    "Commit the generated files",
    "Push the platform-sso branch",
    "Set repo Actions to read+write (one-time)",
    "Confirm the :sso image published to GHCR",
], size=15, mcolor=TEAL)
card(s, Inches(6.8), Inches(1.8), Inches(5.9), Inches(4.5), fill=LIGHT, line=BLUE, lw=1.5)
txt(s, Inches(7.1), Inches(1.95), Inches(5.3), Inches(0.4), ("PLATFORM ADMINISTRATOR", 13, BLUE, True))
bullets(s, Inches(7.1), Inches(2.5), Inches(5.3), Inches(3.6), [
    "Register: image, port 8080, Platform SSO ✅, env empty",
    "Deploy (supply a read:packages token if private)",
    "Enable for the right role(s)",
    "Multi-tenant: match the realm first (05)",
    "Verify the tile opens embedded, no 2nd login",
], size=15, mcolor=BLUE)
txt(s, Inches(0.6), Inches(6.55), Inches(12), Inches(0.4),
    ("Full guide: marketplace/Implementation/  ·  README → 01 → 02–08", 12, GREY, False))
footer(s, 11)

# =====================================================================
out = "Marketplace_Onboarding_Flow.pptx"
prs.save(out)
print(f"wrote {out} with {len(prs.slides._sldIdLst)} slides")

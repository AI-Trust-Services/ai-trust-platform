// Fetch the current user's permissions before building the nav so that each
// nav node is only shown to users who hold at least one of its permissions.
// A page a role has no permission for at all (e.g. Executive → Alerts/Evidence)
// is hidden entirely rather than shown with everything greyed out.
// The check is UX-only; every backend enforces permissions independently.
(async function initShell() {
  let permissions = [];
  let currentUser = { username: "", firstName: "", lastName: "" };
  try {
    const [permRes, meRes] = await Promise.all([
      fetch("/api/users/v1/me/permissions", { cache: "no-store" }),
      fetch("/api/users/v1/me", { cache: "no-store" }),
    ]);
    if (permRes.ok) {
      const data = await permRes.json();
      permissions = data.permissions || [];
    }
    if (meRes.ok) {
      currentUser = await meRes.json();
    }
  } catch (e) {
    permissions = [];
  }

  // pathSegment → permissions that make the node visible (ANY of them suffices).
  // A pathSegment absent from this map is always visible (e.g. "overview").
  const PAGE_PERMISSIONS = {
    "ai-system-registry": ["systems:read", "systems:write"],
    // DTA has no dedicated permission — reuse monitoring:read (same audience).
    "decision-trace-analyzer": ["monitoring:read"],
    "monitoring": ["monitoring:read"],
    "alerts": ["alerts:read", "alerts:handle", "alerts:manage_rules"],
    "assessments": ["assessments:read", "assessments:write", "assessments:approve"],
    "obligations": ["assessments:read", "assessments:write", "assessments:approve"],
    "controls": ["assessments:read", "assessments:write", "assessments:approve"],
    "evidence": ["evidence:read", "evidence:write", "evidence:approve"],
    "users": ["iam:manage"],
    "admin": ["iam:manage"],
  };
  const canSee = (seg) =>
    !PAGE_PERMISSIONS[seg] || PAGE_PERMISSIONS[seg].some((p) => permissions.includes(p));

  const base = window.location.origin;

  // Check if user has systems:read permission
  const canReadSystems = permissions.includes("systems:read");
  const canReadAlerts = permissions.some(p => ["alerts:read", "alerts:handle", "alerts:manage_rules"].includes(p));

  // Determine if user is admin-only (has iam:manage but not systems:read).
  // Using systems:read as the single anchor avoids maintaining an exclusion list
  // that breaks whenever a custom role combines iam:manage with any other permission.
  const isAdminOnly = permissions.includes("iam:manage") && !permissions.includes("systems:read");

  // New task-driven navigation structure - only for non-admin users
  const mainNav = isAdminOnly ? [
      {
        pathSegment: "admin",
        label: "Administration",
        icon: "settings",
        viewUrl: base + "/admin/#/",
        navigationContext: "admin",
      },
      {
        pathSegment: "users",
        label: "Users & Roles",
        icon: "employee",
        viewUrl: base + "/users/",
        navigationContext: "users",
      },
      {
        pathSegment: "admin-ai-providers",
        label: "AI Providers",
        icon: "machine",
        viewUrl: base + "/admin/#/ai-providers",
        navigationContext: "admin-ai-providers",
      },
      {
        pathSegment: "admin-mail-service",
        label: "Mail Service",
        icon: "email",
        viewUrl: base + "/admin/#/mail-service",
        navigationContext: "admin-mail-service",
      },
      {
        pathSegment: "admin-settings",
        label: "Settings",
        icon: "action-settings",
        viewUrl: base + "/admin/#/settings",
        navigationContext: "admin-settings",
      },
  ] : [
      {
        pathSegment: "today",
        label: "Today",
        icon: "home",
        viewUrl: base + "/registry/#/today",
        navigationContext: "today",
      },
      {
        pathSegment: "work",
        label: "My Work",
        icon: "task",
        viewUrl: base + "/registry/#/work",
        navigationContext: "work",
      },
      {
        pathSegment: "systems",
        label: "AI Systems",
        icon: "machine",
        viewUrl: base + "/registry/#/systems",
        navigationContext: "systems",
      },
  ];

  // Legacy navigation (hidden from sidebar, accessible via command palette)
  const legacyNav = [
      {
        pathSegment: "overview",
        label: "Overview",
        icon: "overview-chart",
        viewUrl: base + "/overview/",
        navigationContext: "overview",
      },
      {
        pathSegment: "decision-trace-analyzer",
        label: "Trace Explorer",
        icon: "detail-view",
        viewUrl: base + "/dta/",
        navigationContext: "decision-trace-analyzer",
      },
      {
        pathSegment: "monitoring",
        label: "Monitoring",
        icon: "line-chart",
        viewUrl: base + "/monitoring/",
        navigationContext: "monitoring",
      },
      {
        pathSegment: "alerts",
        label: "Alerts",
        icon: "alert",
        viewUrl: base + "/alerts/",
        navigationContext: "alerts",
      },
      {
        pathSegment: "assessments",
        label: "Assessments",
        icon: "numbered-text",
        viewUrl: base + "/compliance/#/assessments",
        navigationContext: "assessments",
      },
      {
        pathSegment: "obligations",
        label: "Obligations",
        icon: "checklist-item",
        viewUrl: base + "/compliance/#/obligations",
        navigationContext: "obligations",
      },
      {
        pathSegment: "controls",
        label: "Controls",
        icon: "shield",
        viewUrl: base + "/compliance/#/controls",
        navigationContext: "controls",
      },
      {
        pathSegment: "evidence",
        label: "Evidence",
        icon: "attachment",
        viewUrl: base + "/compliance/#/evidence",
        navigationContext: "evidence",
      },
      {
        pathSegment: "users",
        label: "Users & Roles",
        icon: "employee",
        viewUrl: base + "/users/",
        navigationContext: "users",
        viewGroup: "users",
      },
      {
        pathSegment: "admin",
        label: "Administration",
        icon: "settings",
        viewUrl: base + "/admin/#/",
        navigationContext: "admin",
        viewGroup: "admin",
        children: [
          { pathSegment: "users", label: "Users & Roles", viewUrl: base + "/admin/#/users", hideFromNav: true },
          { pathSegment: "ai-providers", label: "AI Providers", viewUrl: base + "/admin/#/ai-providers", hideFromNav: true },
          { pathSegment: "mail-service", label: "Mail Service", viewUrl: base + "/admin/#/mail-service", hideFromNav: true },
          { pathSegment: "settings", label: "Settings", viewUrl: base + "/admin/#/settings", hideFromNav: true },
        ],
      },
  ].filter((node) => canSee(node.pathSegment));

  // Main nav items at top only (legacy items moved to command bar)
  // When isAdminOnly, exclude admin from legacyNav since it's already in mainNav
  const children = [
    ...mainNav,
    // Legacy nav items hidden from sidebar but still routable via command bar
    ...legacyNav
      .filter(node => !(isAdminOnly && (node.pathSegment === "admin" || node.pathSegment === "users")))
      .map(node => ({ ...node, hideFromNav: true })),
  ];

  // Determine default landing page based on role:
  // - Platform admins (only iam:manage, no systems/compliance perms) → admin
  // - Everyone else → today
  const defaultPage = isAdminOnly ? "admin" : "today";

  Luigi.setConfig({
  navigation: {
    nodes: [
      {
        pathSegment: "home",
        label: "Home",
        hideFromNav: true,
        defaultChildNode: defaultPage,
        children: children,
      },
    ],
  },

  routing: {
    useHashRouting: true,
  },

  settings: {
    header: {
      title: "AI Trust",
    },
    responsiveNavigation: "Fiori3",
    sideNavigation: {
      collapsed: true,
    },
    splitView: {
      enabled: false,
    },
    theme: "sap_horizon",
    iframeCreationInterceptor: (iframe) => {
      // Grant clipboard *write* to embedded MFEs — without this, the Permissions
      // Policy on the iframe blocks navigator.clipboard.writeText() (e.g. the
      // registry "Copy ID" button) with a permissions-policy violation.
      // Deliberately NOT granting clipboard-read: no MFE reads the clipboard, and
      // read access would let an MFE silently exfiltrate whatever the user copied.
      iframe.setAttribute("allow", "downloads; clipboard-write");
      iframe.sandbox.add("allow-downloads");
      // Luigi sets iframe.title = "MFE" synchronously after this interceptor returns.
      // One tick deferred so the removal happens after Luigi finishes setting properties.
      setTimeout(() => { iframe.removeAttribute("title"); }, 0);
    },
  },

  lifecycleHooks: {
    luigiAfterInit: () => {
      const style = document.createElement("style");
      style.textContent = `:root {
          --luigi-nav-bg: #0f172a;
          --luigi-nav-width: 256px;
          --luigi__shellbar--height: 48px;
        }

        /* ── Shell bar ── */
        .fd-shellbar {
          background: #ffffff !important;
          border-bottom: none !important;
          box-shadow: none !important;
          height: 48px !important;
          padding-left: 0 !important;
        }
        .fd-shellbar__title,
        .lui-shellbar__title,
        .shellbar-title {
          color: #111827 !important;
          font-family: 'Instrument Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
          font-weight: 600 !important;
          font-size: 14px !important;
          letter-spacing: 0 !important;
          line-height: 1 !important;
          display: inline-flex !important;
          align-items: center !important;
          height: auto !important;
          margin: 0 !important;
          padding: 0 !important;
        }
        .fd-shellbar__logo:empty,
        .fd-shellbar__logo--image-replaced {
          display: none !important;
        }
        .fd-shellbar__group--product {
          flex: 0 0 256px !important;
          flex-grow: 0 !important;
          display: flex !important;
          justify-content: flex-start !important;
          overflow: hidden !important;
          padding: 0 0 0 12px !important;
          margin: 0 !important;
        }
        body.semiCollapsed .fd-shellbar__group--product {
          flex: 0 0 48px !important;
          padding: 0 !important;
          justify-content: center !important;
        }
        .fd-shellbar__branding {
          display: inline-flex !important;
          align-items: center !important;
          justify-content: flex-start !important;
          height: 32px !important;
          padding: 0 !important;
          background: transparent !important;
          cursor: pointer !important;
          outline: none !important;
          border-radius: 4px !important;
        }
        .fd-shellbar__branding:hover { background: rgba(255,255,255,0.07) !important; }
        .fd-shellbar__branding:focus { outline: none !important; box-shadow: none !important; }
        .fd-shellbar__branding:focus-visible {
          outline: 2px solid #1147E9 !important;
          outline-offset: 2px !important;
          box-shadow: none !important;
        }

        .fd-shellbar__group--actions,
        .fd-shellbar__actions {
          display: flex !important;
          align-items: center !important;
          gap: 0 !important;
        }
        .lui-burger,
        .fd-shellbar__button.lui-burger,
        button.fd-button--transparent.lui-burger {
          display: none !important;
        }

        /* ── Sidebar ── */
        .fd-app__sidebar,
        .fd-app__split-view,
        .fd-side-nav,
        .lui-side-nav,
        .lui-nav-container,
        .lui-nav,
        .lui-nav__list-wrapper,
        .fd-nested-list,
        .fd-nested-list__group,
        .fd-nested-list__item,
        .fd-navigation__list,
        [class*="side-nav"],
        [class*="lui-nav"],
        nav.fd-navigation {
          background: #0f172a !important;
          background-color: #0f172a !important;
          border-right: none !important;
          box-shadow: none !important;
          overflow: hidden !important;
        }
        .fd-app__sidebar {
          border-top-right-radius: 10px !important;
          border-bottom-right-radius: 0 !important;
          margin-top: 0 !important;
          padding-top: 0 !important;
          border-top: none !important;
        }
        .fd-shell__content,
        .fd-shell__body,
        .fd-app__body {
          padding-top: 0 !important;
          margin-top: 0 !important;
        }
        .lui-side-nav--collapsed,
        .lui-side-nav {
          background: #0f172a !important;
          background-color: #0f172a !important;
        }
        .fd-app__sidebar,
        .lui-nav-container {
          --fdSideNavBackground: #0f172a !important;
          --fdShellbarBackground: #0f172a !important;
          --sapShellColor: #0f172a !important;
          --sapBaseColor: #0f172a !important;
          --sapBackgroundColor: #0f172a !important;
          --sapNeutralBackground: #0f172a !important;
          --sapContent_ForegroundBackgroundColor: #0f172a !important;
        }

        /* ── Nav items ── */
        .fd-navigation__list-item a,
        .lui-nav__item a,
        .lui-navigation-list-item a,
        li.fd-navigation__list-item a,
        .fd-nested-list__link {
          color: #94a3b8 !important;
          font-weight: 400 !important;
          font-size: 13px !important;
          font-family: 'Instrument Sans', -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
          border-radius: 6px !important;
          margin: 1px 0 !important;
          padding: 7px 12px !important;
          background: transparent !important;
          border: none !important;
          box-shadow: inset 2px 0 0 transparent !important;
          transition: background 0.1s, color 0.1s !important;
          display: flex !important;
          align-items: center !important;
          gap: 10px !important;
        }
        .fd-navigation__list-item a:hover,
        .lui-nav__item a:hover,
        .fd-nested-list__link:hover {
          background: rgba(255,255,255,0.07) !important;
          color: #e2e8f0 !important;
        }
        .fd-navigation__list-item--selected a,
        .lui-nav__item--selected a,
        .is-selected a,
        .lui-navigation-list-item.is-selected a,
        .fd-nested-list__link.is-selected,
        .fd-nested-list__link--current {
          background: rgba(17,71,233,0.18) !important;
          color: #93c5fd !important;
          font-weight: 500 !important;
          box-shadow: inset 2px 0 0 #1147E9 !important;
        }
        .fd-navigation__list-item--selected::before,
        .lui-nav__item--selected::before,
        .is-selected::before {
          display: none !important;
        }
        .fd-navigation__icon,
        .lui-nav__icon,
        .sap-icon,
        .fd-nested-list__icon {
          color: #64748b !important;
          font-size: 15px !important;
        }
        .fd-navigation__list-item a:hover .sap-icon,
        .lui-nav__item a:hover .sap-icon,
        .fd-nested-list__link:hover .sap-icon,
        .fd-nested-list__link:hover .fd-nested-list__icon {
          color: #94a3b8 !important;
        }
        .is-selected .sap-icon,
        .fd-navigation__list-item--selected .sap-icon,
        .fd-nested-list__link.is-selected .sap-icon,
        .fd-nested-list__link--current .sap-icon {
          color: #60a5fa !important;
        }
        .fd-nested-list__title {
          color: inherit !important;
        }
        .fd-nested-list__item,
        .lui-nav__item,
        .fd-navigation__list-item,
        li.fd-navigation__list-item {
          border-bottom: none !important;
          border-top: none !important;
          list-style: none !important;
        }
        .fd-nested-list,
        .fd-navigation__list {
          padding: 0 !important;
          margin: 0 !important;
          border-bottom: none !important;
          border-top: none !important;
        }

        .fd-navigation__list-item a:focus,
        .lui-nav__item a:focus,
        .lui-navigation-list-item a:focus,
        .fd-nested-list__link:focus,
        .fd-nested-list__link:focus-within {
          outline: none !important;
          box-shadow: none !important;
        }
        .fd-navigation__list-item--selected a:focus,
        .lui-nav__item--selected a:focus,
        .is-selected a:focus,
        .fd-nested-list__link.is-selected:focus,
        .fd-nested-list__link--current:focus {
          outline: none !important;
          box-shadow: inset 2px 0 0 #1147E9 !important;
        }

        /* ── Hide Luigi overlay badges (split-view btn, breadcrumbs, view labels) ── */
        .lui-split-view-btn,
        .lui-split-view__start-btn,
        [class*="split-view"][class*="btn"],
        .lui-breadcrumb,
        .fd-breadcrumb,
        .fd-dynamic-page__summarized-title-area,
        [data-testid*="split"],
        .lui-view-group-badge,
        .lui-icon-btn[title*="split" i],
        .fd-shellbar__button[title*="split" i] {
          display: none !important;
        }

        /* ── App / iframe ── */
        html {
          background: #ffffff !important;
        }
        :root {
          --sapBackgroundColor: #ffffff;
          --sapShellColor: #ffffff;
          --sapBaseColor: #ffffff;
          --sapContent_ForegroundBackgroundColor: #ffffff;
          --sapPageHeader_Background: #ffffff;
        }
        .fd-app__main,
        .fd-app__main-container,
        .fd-shell,
        .fd-shell__content,
        .fd-shell__body,
        [class*="app__main"],
        [class*="main-container"],
        [class*="main-frame"] {
          background: #ffffff !important;
          background-color: #ffffff !important;
          border: none !important;
        }
        body { background: #ffffff !important; }
        .fd-app, .lui-app, #app {
          background: linear-gradient(to right, #0f172a 256px, #ffffff 256px) !important;
        }
        body.semiCollapsed .fd-app, body.semiCollapsed .lui-app, body.semiCollapsed #app {
          background: linear-gradient(to right, #0f172a 48px, #ffffff 48px) !important;
        }

        /* ── Dark mode baked into static CSS — active immediately via html.dark ── */
        html.dark {
          background: #09090b !important;
          --sapBackgroundColor: #09090b;
          --sapShellColor: #09090b;
          --sapBaseColor: #09090b;
          --sapContent_ForegroundBackgroundColor: #09090b;
          --sapPageHeader_Background: #09090b;
        }
        html.dark body,
        html.dark .fd-shell, html.dark .fd-shell__content, html.dark .fd-shell__body,
        html.dark .fd-app__main, html.dark .fd-app__main-container,
        html.dark [class*="app__main"], html.dark [class*="main-container"], html.dark [class*="main-frame"],
        html.dark .fd-busy-indicator, html.dark [class*="loading-indicator"], html.dark [class*="busy-indicator"] {
          background: #09090b !important;
          background-color: #09090b !important;
        }
        html.dark .fd-app, html.dark .lui-app, html.dark #app {
          background: linear-gradient(to right, #0f172a 256px, #09090b 256px) !important;
        }
        html.dark body.semiCollapsed .fd-app, html.dark body.semiCollapsed .lui-app, html.dark body.semiCollapsed #app {
          background: linear-gradient(to right, #0f172a 48px, #09090b 48px) !important;
        }

        /* ── Collapsed: icons only, centered ── */
        .lui-side-nav--collapsed .fd-navigation__list-item a,
        .lui-side-nav--collapsed .lui-nav__item a,
        body.semiCollapsed .fd-nested-list__link,
        .lui-side-nav--collapsed .fd-nested-list__link {
          justify-content: center !important;
          padding: 10px !important;
          margin: 2px 0 !important;
        }
        .lui-side-nav--collapsed .fd-navigation__text,
        .lui-side-nav--collapsed .lui-nav__label,
        .lui-side-nav--collapsed span:not(.sap-icon):not(.fd-navigation__icon),
        body.semiCollapsed .fd-nested-list__title,
        .lui-side-nav--collapsed .fd-nested-list__title {
          display: none !important;
        }
        .lui-side-nav--collapsed .sap-icon,
        .lui-side-nav--collapsed .fd-navigation__icon,
        body.semiCollapsed .sap-icon,
        body.semiCollapsed .fd-navigation__icon {
          font-size: 17px !important;
          margin: 0 !important;
        }

        /* ── Brand logo ── */
        .luigi-brand-icon {
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
          pointer-events: none !important;
        }
        .luigi-brand-icon img {
          pointer-events: none !important;
        }
        .brand-logo-full {
          height: 30px !important;
          display: block !important;
        }
        .brand-logo-full--dark {
          height: 30px !important;
          display: none !important;
        }
        .brand-logo-icon {
          width: 30px !important;
          height: 30px !important;
          display: none !important;
        }
        .brand-logo-icon--dark {
          width: 30px !important;
          height: 30px !important;
          display: none !important;
        }
        body.semiCollapsed .brand-logo-full {
          display: none !important;
        }
        body.semiCollapsed .brand-logo-full--dark {
          display: none !important;
        }
        body.semiCollapsed .brand-logo-icon {
          display: block !important;
        }
        body.semiCollapsed .brand-logo-icon--dark {
          display: none !important;
        }
        html.dark .brand-logo-full {
          display: none !important;
        }
        html.dark .brand-logo-full--dark {
          display: block !important;
        }
        html.dark .brand-logo-icon {
          display: none !important;
        }
        html.dark .brand-logo-icon--dark {
          display: none !important;
        }
        html.dark body.semiCollapsed .brand-logo-full--dark {
          display: none !important;
        }
        html.dark body.semiCollapsed .brand-logo-icon {
          display: none !important;
        }
        html.dark body.semiCollapsed .brand-logo-icon--dark {
          display: block !important;
        }
        .fd-shellbar__title,
        .lui-shellbar__title,
        .shellbar-title {
          display: none !important;
        }

        /* ── Sidebar tooltip ── */
        #luigi-nav-tooltip {
          position: fixed;
          background: #111827;
          color: rgba(255,255,255,0.9);
          padding: 5px 10px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 500;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          white-space: nowrap;
          pointer-events: none;
          box-shadow: 0 4px 12px rgba(0,0,0,0.25);
          z-index: 9999;
          display: none;
        }

        /* ── Recent Systems section ── */
        #luigi-recent-systems {
          display: flex;
          flex-direction: column;
          padding: 0 8px;
          margin-top: 16px;
          border-top: 1px solid rgba(255,255,255,0.08);
          padding-top: 8px;
          overflow: hidden;
        }
        #luigi-recent-systems .recent-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 8px 6px;
          font-size: 10px;
          font-weight: 600;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: #64748b;
        }
        #luigi-recent-systems .recent-header a {
          color: #64748b;
          font-weight: 400;
          text-decoration: none;
          font-size: 10px;
          text-transform: none;
          letter-spacing: 0;
        }
        #luigi-recent-systems .recent-header a:hover {
          color: #94a3b8;
          text-decoration: underline;
        }
        #luigi-recent-systems .recent-item {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 10px;
          margin: 1px 0;
          border-radius: 6px;
          color: #94a3b8;
          font-size: 13px;
          font-weight: 400;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          text-decoration: none;
          cursor: pointer;
          transition: background 0.1s, color 0.1s;
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
        }
        #luigi-recent-systems .recent-item:hover {
          background: rgba(255,255,255,0.07);
          color: #e2e8f0;
        }
        #luigi-recent-systems .recent-item .recent-dot {
          flex-shrink: 0;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #3b82f6;
        }
        #luigi-recent-systems .recent-item .recent-name {
          flex: 1;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        body.semiCollapsed #luigi-recent-systems {
          display: none;
        }

        /* ── Collapse button ── */
        #luigi-collapse-btn {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
          padding: 10px 16px;
          background: transparent;
          border: none;
          border-top: none;
          color: #64748b;
          font-size: 13px;
          font-weight: 400;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          cursor: pointer;
          width: 100%;
          box-sizing: border-box;
          text-align: left;
          transition: color 0.1s, background 0.1s;
        }
        #luigi-collapse-btn:hover {
          color: #94a3b8;
          background: rgba(255,255,255,0.07);
        }
        body.semiCollapsed #luigi-collapse-btn {
          justify-content: center;
          padding: 10px;
        }
        body.semiCollapsed #luigi-collapse-btn .collapse-label {
          display: none;
        }

      `;
      document.head.appendChild(style);

      // Remove "MFE" title attribute from any iframes already in the DOM at init time
      // (the first iframe is created before luigiAfterInit fires).
      document.querySelectorAll("iframe[title='MFE']").forEach(f => f.removeAttribute("title"));

      // JS tooltip for collapsed sidebar icons
      const tooltip = document.createElement("div");
      tooltip.id = "luigi-nav-tooltip";
      document.body.appendChild(tooltip);

      function attachTooltips() {
        const links = document.querySelectorAll(".fd-nested-list__link[title]");
        links.forEach(link => {
          if (link.dataset.tooltipBound) return;
          link.dataset.tooltipBound = "1";
          link.addEventListener("mouseenter", () => {
            if (!document.body.classList.contains("semiCollapsed")) return;
            const rect = link.getBoundingClientRect();
            tooltip.textContent = link.getAttribute("title");
            tooltip.style.display = "block";
            tooltip.style.left = (rect.right + 8) + "px";
            tooltip.style.top = (rect.top + rect.height / 2 - tooltip.offsetHeight / 2) + "px";
          });
          link.addEventListener("mouseleave", () => {
            tooltip.style.display = "none";
          });
        });
      }

      // Attach once sidebar is in DOM, re-check on nav changes
      const observer = new MutationObserver(attachTooltips);
      const waitForNav = setInterval(() => {
        const nav = document.querySelector(".fd-nested-list");
        if (nav) {
          clearInterval(waitForNav);
          attachTooltips();
          observer.observe(nav, { childList: true, subtree: true });
        }
      }, 200);

      // Inject brand icon shown in place of the title when collapsed
      const waitForBranding = setInterval(() => {
        const branding = document.querySelector(".fd-shellbar__branding");
        if (!branding) return;
        clearInterval(waitForBranding);
        const icon = document.createElement("span");
        icon.className = "luigi-brand-icon";
        const imgFull = document.createElement("img");
        imgFull.src = "/brand/svg/horizontal_color.svg";
        imgFull.alt = "AI Trust";
        imgFull.className = "brand-logo-full";
        const imgFullDark = document.createElement("img");
        imgFullDark.src = "/brand/svg/horizontal_white.svg";
        imgFullDark.alt = "AI Trust";
        imgFullDark.className = "brand-logo-full--dark";
        const imgIcon = document.createElement("img");
        imgIcon.src = "/brand/svg/Icon_color.svg";
        imgIcon.alt = "AI Trust";
        imgIcon.className = "brand-logo-icon";
        const imgIconDark = document.createElement("img");
        imgIconDark.src = "/brand/svg/Icon_white.svg";
        imgIconDark.alt = "AI Trust";
        imgIconDark.className = "brand-logo-icon--dark";
        icon.appendChild(imgFull);
        icon.appendChild(imgFullDark);
        icon.appendChild(imgIcon);
        icon.appendChild(imgIconDark);
        branding.appendChild(icon);
        branding.addEventListener("click", () => {
          window.location.hash = '#/home/today';
        });
      }, 200);

      // Inject collapse button at the bottom of the sidebar
      const waitForCollapse = setInterval(() => {
        if (document.getElementById("luigi-collapse-btn")) { clearInterval(waitForCollapse); return; }
        const sidebar = document.querySelector(".lui-side-nav") ||
                        document.querySelector(".fd-side-nav") ||
                        document.querySelector(".lui-nav-container");
        if (!sidebar) return;
        clearInterval(waitForCollapse);

        // Make sidebar a flex column so margin-top:auto pushes the button down
        sidebar.style.display = "flex";
        sidebar.style.flexDirection = "column";

        const btn = document.createElement("button");
        btn.id = "luigi-collapse-btn";

        const arrow = document.createElement("span");
        const label = document.createElement("span");
        label.className = "collapse-label";
        label.textContent = "Collapse";
        btn.appendChild(arrow);
        btn.appendChild(label);

        function updateState() {
          const collapsed = document.body.classList.contains("semiCollapsed");
          arrow.textContent = collapsed ? "›" : "‹";
        }
        updateState();

        btn.addEventListener("click", () => {
          const burger = document.querySelector(".lui-burger");
          if (burger) burger.click();
        });

        new MutationObserver(updateState).observe(document.body, {
          attributes: true, attributeFilter: ["class"],
        });

        sidebar.appendChild(btn);

        // Only show Recent Systems section if user can read systems
        if (canReadSystems) {
          // Inject Recent Systems section into sidebar (before the collapse button)
          const recentSection = document.createElement("div");
          recentSection.id = "luigi-recent-systems";
          recentSection.innerHTML = `
            <div class="recent-header">
              <span>Recent Systems</span>
              <a href="#/home/systems">View all systems</a>
            </div>
            <div id="recent-systems-list"></div>
          `;

          // Insert before the collapse button (both are direct children of sidebar now)
          sidebar.insertBefore(recentSection, btn);

          // Fetch and render recent systems
          async function loadRecentSystems() {
            const list = document.getElementById('recent-systems-list');
            if (!list) return;

            try {
              const res = await fetch('/api/registry/v1/systems?limit=5', { cache: 'no-store' });
              if (!res.ok) throw new Error('Failed to fetch');
              const systems = await res.json();

              // Store in localStorage for recent tracking (ordered by last access)
              const recentIds = JSON.parse(localStorage.getItem('ai_trust_recent_systems') || '[]');

              // Sort systems by their position in recentIds (most recent first)
              const sortedSystems = [...systems].sort((a, b) => {
                const aIdx = recentIds.indexOf(a.id);
                const bIdx = recentIds.indexOf(b.id);
                if (aIdx === -1 && bIdx === -1) return 0;
                if (aIdx === -1) return 1;
                if (bIdx === -1) return -1;
                return aIdx - bIdx;
              });

              // Take top 5
              const recent = sortedSystems.slice(0, 5);

              if (recent.length === 0) {
                list.innerHTML = '<div style="padding:8px 10px; color:#64748b; font-size:12px;">No recent systems</div>';
                return;
              }

              list.innerHTML = recent.map(sys => {
                // Color dot based on tier
                const dotColors = {
                  'prohibited': '#ef4444',
                  'gpai-systemic': '#f97316',
                  'gpai-standard': '#eab308',
                  'high': '#f97316',
                  'limited': '#22c55e',
                  'minimal': '#22c55e',
                };
                const dotColor = dotColors[sys.tier] || '#3b82f6';

                return `
                  <a class="recent-item" href="#/home/systems/${sys.id}" title="${sys.name}">
                    <span class="recent-dot" style="background:${dotColor}"></span>
                    <span class="recent-name">${sys.name}</span>
                  </a>
                `;
              }).join('');
            } catch (e) {
              console.error('Failed to load recent systems:', e);
              list.innerHTML = '<div style="padding:8px 10px; color:#64748b; font-size:12px;">Failed to load</div>';
            }
          }

          loadRecentSystems();

          // Refresh when navigating to a system (track recent)
          window.addEventListener('hashchange', () => {
            const match = window.location.hash.match(/#\/home\/systems\/(SYS-[A-Z0-9]+)/);
            if (match) {
              const systemId = match[1];
              const recentIds = JSON.parse(localStorage.getItem('ai_trust_recent_systems') || '[]');
              const filtered = recentIds.filter(id => id !== systemId);
              filtered.unshift(systemId);
              localStorage.setItem('ai_trust_recent_systems', JSON.stringify(filtered.slice(0, 10)));
              setTimeout(loadRecentSystems, 500); // Refresh list after navigation
            }
          });
        }
      }, 300);

      // Inject alerts bell + account chip into shell bar
      const waitForShellbar = setInterval(() => {
        const shellbar = document.querySelector(".fd-shellbar__group--actions, .fd-shellbar__actions");
        if (shellbar) {
          clearInterval(waitForShellbar);

          const displayName = [currentUser.firstName, currentUser.lastName].filter(Boolean).join(" ") || currentUser.username;
          const initials = currentUser.firstName && currentUser.lastName
            ? (currentUser.firstName[0] + currentUser.lastName[0]).toUpperCase()
            : (currentUser.username || "?").slice(0, 2).toUpperCase();
          const rawRole = (currentUser.roles || [])[0] || "";
          const roleLabel = rawRole.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

          // ── Command Palette (search + navigation) ──
          const commandPalette = document.createElement("div");
          commandPalette.id = "luigi-command-palette";
          commandPalette.style.cssText = `
            display:none; position:fixed; top:0; left:0; right:0; bottom:0;
            background:rgba(0,0,0,0.5); backdrop-filter:blur(4px);
            z-index:10000; align-items:flex-start; justify-content:center;
            padding-top:min(20vh, 150px);
          `;
          commandPalette.innerHTML = `
            <div id="command-modal" style="
              background:#ffffff; border-radius:12px;
              box-shadow:0 25px 50px -12px rgba(0,0,0,0.25);
              width:100%; max-width:560px; overflow:hidden;
              border:1px solid #e4e4e7;
            ">
              <div style="display:flex; align-items:center; padding:12px 16px; border-bottom:1px solid #e4e4e7;">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
                  <circle cx="11" cy="11" r="8"/>
                  <path d="m21 21-4.3-4.3"/>
                </svg>
                <input id="command-input" type="text" placeholder="Search systems, models, or type a command..." style="
                  flex:1; border:none; outline:none; padding:8px 12px;
                  font-size:15px; background:transparent; color:#111827;
                  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
                " autocomplete="off" />
                <kbd style="
                  background:#f4f4f5; border:1px solid #e4e4e7; border-radius:4px;
                  padding:2px 6px; font-size:11px; color:#71717a;
                  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
                ">ESC</kbd>
              </div>
              <div id="command-tabs" style="display:flex; gap:0; padding:0 12px; border-bottom:1px solid #e4e4e7;">
                <button id="tab-actions" class="command-tab active" style="
                  padding:10px 16px; font-size:13px; font-weight:500; color:#111827;
                  background:transparent; border:none; cursor:pointer;
                  border-bottom:2px solid #1147E9; margin-bottom:-1px;
                  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
                ">Actions</button>
                <button id="tab-navigate" class="command-tab" style="
                  padding:10px 16px; font-size:13px; font-weight:500; color:#9ca3af;
                  background:transparent; border:none; cursor:pointer;
                  border-bottom:2px solid transparent; margin-bottom:-1px;
                  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
                ">Navigate</button>
              </div>
              <div id="command-results" style="max-height:360px; overflow-y:auto;">
                <div id="command-default" style="padding:8px;"></div>
                <div id="command-search-results"></div>
              </div>
              <div style="padding:8px 12px; border-top:1px solid #e4e4e7; display:flex; gap:16px; font-size:11px; color:#9ca3af;">
                <span><kbd style="background:#f4f4f5; padding:1px 4px; border-radius:2px; font-size:10px;">↑↓</kbd> navigate</span>
                <span><kbd style="background:#f4f4f5; padding:1px 4px; border-radius:2px; font-size:10px;">↵</kbd> select</span>
                <span><kbd style="background:#f4f4f5; padding:1px 4px; border-radius:2px; font-size:10px;">esc</kbd> close</span>
              </div>
            </div>
          `;
          document.body.appendChild(commandPalette);

          // Command palette state
          let commandItems = [];
          let selectedIndex = 0;
          let systemsCache = [];
          let modelsCache = [];
          let activeTab = 'actions';

          // [REVIEW_MODE] -- POC feedback collection, remove before merging to main
          // Helper to get review mode command with current state
          function getReviewModeCommand() {
            const isEnabled = localStorage.getItem('ai_trust_review_mode') === 'true';
            return {
              type: 'action',
              icon: isEnabled ? '🚫' : '📝',
              label: isEnabled ? 'Disable Review Mode (DEV ONLY)' : 'Enable Review Mode (DEV ONLY)',
              description: 'POC feedback collection',
              action: 'toggleReviewMode'
            };
          }
          // [/REVIEW_MODE]

          // Define action commands (quick actions) - filtered by permissions
          const baseActionCommands = [
            { type: 'nav', icon: '➕', label: 'Register new AI System', description: 'Start registration wizard', path: '#/home/systems?register=true', segment: 'ai-system-registry' },
            { type: 'nav', icon: '🔍', label: 'Search AI Systems', description: 'Find systems by name or ID', path: '#/home/systems', segment: 'ai-system-registry' },
            { type: 'nav', icon: '📊', label: 'View Dashboard', description: 'Compliance posture overview', path: '#/home/overview' },
          ].filter(cmd => !cmd.segment || canSee(cmd.segment));

          // Dynamic getter for action commands (includes review mode with current state)
          function getActionCommands() {
            // [REVIEW_MODE] -- POC feedback collection, change to: return baseActionCommands;
            return [...baseActionCommands, getReviewModeCommand()];
            // [/REVIEW_MODE]
          }

          // Define navigation commands (all views) - filtered by permissions
          const navCommands = [
            { type: 'nav', icon: '🏠', label: 'Today', description: 'Your daily overview', path: '#/home/today' },
            { type: 'nav', icon: '📋', label: 'My Work', description: 'Tasks and assignments', path: '#/home/work' },
            { type: 'nav', icon: '🤖', label: 'AI Systems', description: 'System registry', path: '#/home/systems', segment: 'ai-system-registry' },
            { type: 'divider', label: 'Compliance' },
            { type: 'nav', icon: '📊', label: 'Overview Dashboard', description: 'Compliance posture overview', path: '#/home/overview' },
            { type: 'nav', icon: '📝', label: 'Assessments', description: 'Compliance assessments', path: '#/home/assessments', segment: 'assessments' },
            { type: 'nav', icon: '✅', label: 'Obligations', description: 'Regulatory obligations', path: '#/home/obligations', segment: 'obligations' },
            { type: 'nav', icon: '🛡️', label: 'Controls', description: 'Security and compliance controls', path: '#/home/controls', segment: 'controls' },
            { type: 'nav', icon: '📎', label: 'Evidence', description: 'Compliance evidence files', path: '#/home/evidence', segment: 'evidence' },
            { type: 'divider', label: 'Operations' },
            { type: 'nav', icon: '🔍', label: 'Trace Explorer', description: 'Decision trace analyzer', path: '#/home/decision-trace-analyzer', segment: 'decision-trace-analyzer' },
            { type: 'nav', icon: '📈', label: 'Monitoring', description: 'Live signals and metrics', path: '#/home/monitoring', segment: 'monitoring' },
            { type: 'nav', icon: '🔔', label: 'Alerts', description: 'View and manage alerts', path: '#/home/alerts', segment: 'alerts' },
            { type: 'divider', label: 'Administration' },
            { type: 'nav', icon: '👥', label: 'Users & Roles', description: 'IAM management', path: '#/home/users', segment: 'users' },
          ].filter(cmd => cmd.type === 'divider' || !cmd.segment || canSee(cmd.segment))
           .filter((cmd, i, arr) => {
             // Remove dividers that have no items after them
             if (cmd.type !== 'divider') return true;
             const nextNonDivider = arr.slice(i + 1).find(c => c.type !== 'divider');
             return nextNonDivider !== undefined;
           });

          // All commands for search (navCommands is static, actionCommands are fetched dynamically)
          function getAllNavCommands() {
            return [...getActionCommands(), ...navCommands];
          }

          function setActiveTab(tab) {
            activeTab = tab;
            const actionsTab = document.getElementById('tab-actions');
            const navigateTab = document.getElementById('tab-navigate');
            const d = document.documentElement.classList.contains('dark');

            if (tab === 'actions') {
              actionsTab.style.color = d ? '#f9fafb' : '#111827';
              actionsTab.style.borderBottomColor = '#1147E9';
              navigateTab.style.color = '#9ca3af';
              navigateTab.style.borderBottomColor = 'transparent';
            } else {
              navigateTab.style.color = d ? '#f9fafb' : '#111827';
              navigateTab.style.borderBottomColor = '#1147E9';
              actionsTab.style.color = '#9ca3af';
              actionsTab.style.borderBottomColor = 'transparent';
            }

            selectedIndex = 0;
            renderCommandItems([]);
          }

          function renderCommandItems(items) {
            const container = document.getElementById('command-search-results');
            const defaultSection = document.getElementById('command-default');
            const d = document.documentElement.classList.contains('dark');

            // If no search query, show tab content
            if (items.length === 0) {
              container.innerHTML = '';
              defaultSection.style.display = 'block';

              const currentCommands = activeTab === 'actions' ? getActionCommands() : navCommands;
              let html = '';
              let idx = 0;

              currentCommands.forEach(cmd => {
                if (cmd.type === 'divider') {
                  html += `<div style="padding:12px 12px 8px; font-size:11px; font-weight:600; color:#9ca3af; text-transform:uppercase; letter-spacing:0.05em;">${cmd.label}</div>`;
                } else {
                  const isSelected = idx === selectedIndex;
                  html += `
                    <div class="command-item" data-index="${idx}" style="
                      display:flex; align-items:center; gap:12px; padding:10px 12px;
                      cursor:pointer; border-radius:6px; margin:2px 8px;
                      background:${isSelected ? (d ? 'rgba(255,255,255,0.1)' : '#f4f4f5') : 'transparent'};
                    ">
                      <span style="font-size:16px;">${cmd.icon}</span>
                      <div style="flex:1; min-width:0;">
                        <div style="font-size:13px; font-weight:500; color:${d ? '#f9fafb' : '#111827'};">${cmd.label}</div>
                        <div style="font-size:11px; color:#9ca3af;">${cmd.description}</div>
                      </div>
                      <span style="font-size:10px; color:#9ca3af;">⏎</span>
                    </div>
                  `;
                  idx++;
                }
              });

              defaultSection.innerHTML = html;
              commandItems = currentCommands.filter(c => c.type !== 'divider');

              // Add click handlers
              defaultSection.querySelectorAll('.command-item').forEach(el => {
                el.addEventListener('click', () => {
                  const index = parseInt(el.dataset.index);
                  executeCommand(commandItems[index]);
                });
                el.addEventListener('mouseenter', () => {
                  selectedIndex = parseInt(el.dataset.index);
                  updateSelection();
                });
              });
            } else {
              // Search results mode
              defaultSection.style.display = 'none';
              let html = '';
              let idx = 0;

              items.forEach(item => {
                if (item.type === 'divider') {
                  html += `<div style="padding:12px 12px 8px; font-size:11px; font-weight:600; color:#9ca3af; text-transform:uppercase; letter-spacing:0.05em;">${item.label}</div>`;
                } else {
                  const isSelected = idx === selectedIndex;
                  html += `
                    <div class="command-item" data-index="${idx}" style="
                      display:flex; align-items:center; gap:12px; padding:10px 12px;
                      cursor:pointer; border-radius:6px; margin:2px 8px;
                      background:${isSelected ? (d ? 'rgba(255,255,255,0.1)' : '#f4f4f5') : 'transparent'};
                    ">
                      <span style="font-size:16px;">${item.icon}</span>
                      <div style="flex:1; min-width:0;">
                        <div style="font-size:13px; font-weight:500; color:${d ? '#f9fafb' : '#111827'};">${item.label}</div>
                        <div style="font-size:11px; color:#9ca3af;">${item.description}</div>
                      </div>
                      ${item.type === 'system' ? '<span style="font-size:10px; color:#9ca3af; background:' + (d ? 'rgba(255,255,255,0.1)' : '#f4f4f5') + '; padding:2px 6px; border-radius:4px;">System</span>' : ''}
                      ${item.type === 'model' ? '<span style="font-size:10px; color:#9ca3af; background:' + (d ? 'rgba(255,255,255,0.1)' : '#f4f4f5') + '; padding:2px 6px; border-radius:4px;">Model</span>' : ''}
                      ${item.type === 'nav' ? '<span style="font-size:10px; color:#9ca3af;">⏎</span>' : ''}
                    </div>
                  `;
                  idx++;
                }
              });

              container.innerHTML = html;
              commandItems = items.filter(i => i.type !== 'divider');

              // Add click handlers
              container.querySelectorAll('.command-item').forEach(el => {
                el.addEventListener('click', () => {
                  const index = parseInt(el.dataset.index);
                  executeCommand(commandItems[index]);
                });
                el.addEventListener('mouseenter', () => {
                  selectedIndex = parseInt(el.dataset.index);
                  updateSelection();
                });
              });
            }
          }

          function updateSelection() {
            document.querySelectorAll('.command-item').forEach((el, i) => {
              const d = document.documentElement.classList.contains('dark');
              el.style.background = i === selectedIndex ? (d ? 'rgba(255,255,255,0.1)' : '#f4f4f5') : 'transparent';
            });
          }

          function executeCommand(item) {
            if (!item) return;
            closeCommandPalette();

            if (item.type === 'nav') {
              window.location.hash = item.path;
            } else if (item.type === 'system') {
              window.location.hash = `#/home/systems/${item.id}`;
            } else if (item.type === 'model') {
              window.location.hash = `#/home/models/${item.id}`;
            }
            // [REVIEW_MODE] -- POC feedback collection, remove this entire else-if block before merging to main
            else if (item.type === 'action' && item.action === 'toggleReviewMode') {
              // DEV ONLY: Toggle review mode in the registry iframe
              const reviewKey = 'ai_trust_review_mode';
              const isEnabled = localStorage.getItem(reviewKey) === 'true';
              if (isEnabled) {
                localStorage.removeItem(reviewKey);
                console.log('%c🔍 Review mode disabled', 'color: #ef4444; font-weight: bold');
              } else {
                localStorage.setItem(reviewKey, 'true');
                console.log('%c🔍 Review mode enabled', 'color: #22c55e; font-weight: bold');
              }
              // Reload the current iframe to pick up the change
              const iframe = document.querySelector('iframe[title="Luigi content"]');
              if (iframe) iframe.contentWindow.location.reload();
            }
            // [/REVIEW_MODE]
          }

          async function searchCommand(query) {
            const q = query.toLowerCase().trim();
            const results = [];

            if (!q) {
              selectedIndex = 0;
              renderCommandItems([]);
              return;
            }

            // Hide tabs when searching
            document.getElementById('command-tabs').style.display = 'none';

            // Search navigation commands
            const matchingNav = getAllNavCommands().filter(cmd =>
              cmd.type !== 'divider' &&
              (cmd.label.toLowerCase().includes(q) || cmd.description.toLowerCase().includes(q))
            );
            if (matchingNav.length > 0) {
              results.push({ type: 'divider', label: 'Navigation' });
              results.push(...matchingNav.slice(0, 5));
            }

            // Search systems
            if (systemsCache.length === 0) {
              try {
                const res = await fetch('/api/registry/v1/systems', { cache: 'no-store' });
                if (res.ok) systemsCache = await res.json();
              } catch {}
            }
            const matchingSystems = systemsCache.filter(s =>
              s.name.toLowerCase().includes(q) ||
              (s.description || '').toLowerCase().includes(q) ||
              s.id.toLowerCase().includes(q)
            );
            if (matchingSystems.length > 0) {
              results.push({ type: 'divider', label: 'AI Systems' });
              matchingSystems.slice(0, 5).forEach(s => {
                results.push({
                  type: 'system',
                  icon: '🤖',
                  label: s.name,
                  description: s.description || s.provider || s.id,
                  id: s.id,
                });
              });
            }

            // Search models
            if (modelsCache.length === 0) {
              try {
                const res = await fetch('/api/registry/v1/models', { cache: 'no-store' });
                if (res.ok) modelsCache = await res.json();
              } catch {}
            }
            const matchingModels = modelsCache.filter(m =>
              m.name.toLowerCase().includes(q) ||
              (m.provider || '').toLowerCase().includes(q) ||
              m.id.toLowerCase().includes(q)
            );
            if (matchingModels.length > 0) {
              results.push({ type: 'divider', label: 'Models' });
              matchingModels.slice(0, 5).forEach(m => {
                results.push({
                  type: 'model',
                  icon: '🧠',
                  label: m.name,
                  description: `${m.provider || 'Unknown'} · v${m.version || '1.0'}`,
                  id: m.id,
                });
              });
            }

            // No results
            if (results.length === 0) {
              results.push({
                type: 'nav',
                icon: '🔍',
                label: `No results for "${query}"`,
                description: 'Try a different search term',
                path: '#/home/systems',
              });
            }

            selectedIndex = 0;
            renderCommandItems(results);
          }

          function openCommandPalette() {
            const d = document.documentElement.classList.contains('dark');
            commandPalette.style.display = 'flex';
            const modal = document.getElementById('command-modal');
            modal.style.background = d ? '#18181b' : '#ffffff';
            modal.style.borderColor = d ? 'rgba(255,255,255,0.1)' : '#e4e4e7';
            modal.querySelectorAll('div').forEach(el => {
              if (el.style.borderBottom) el.style.borderColor = d ? 'rgba(255,255,255,0.1)' : '#e4e4e7';
              if (el.style.borderTop) el.style.borderColor = d ? 'rgba(255,255,255,0.1)' : '#e4e4e7';
            });
            const input = document.getElementById('command-input');
            input.style.color = d ? '#f9fafb' : '#111827';
            input.value = '';
            input.focus();
            selectedIndex = 0;
            activeTab = 'actions';
            document.getElementById('command-tabs').style.display = 'flex';
            setActiveTab('actions');
          }

          function closeCommandPalette() {
            commandPalette.style.display = 'none';
            document.getElementById('command-input').value = '';
          }

          // Event handlers
          commandPalette.addEventListener('click', (e) => {
            if (e.target === commandPalette) closeCommandPalette();
          });

          document.getElementById('command-input').addEventListener('input', (e) => {
            if (e.target.value.trim()) {
              searchCommand(e.target.value);
            } else {
              document.getElementById('command-tabs').style.display = 'flex';
              selectedIndex = 0;
              renderCommandItems([]);
            }
          });

          // Tab click handlers
          document.getElementById('tab-actions').addEventListener('click', () => setActiveTab('actions'));
          document.getElementById('tab-navigate').addEventListener('click', () => setActiveTab('navigate'));

          document.getElementById('command-input').addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
              closeCommandPalette();
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              selectedIndex = Math.min(selectedIndex + 1, commandItems.length - 1);
              updateSelection();
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              selectedIndex = Math.max(selectedIndex - 1, 0);
              updateSelection();
            } else if (e.key === 'Enter') {
              e.preventDefault();
              executeCommand(commandItems[selectedIndex]);
            }
          });

          // Global keyboard shortcut
          document.addEventListener('keydown', (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
              e.preventDefault();
              if (commandPalette.style.display === 'none') {
                openCommandPalette();
              } else {
                closeCommandPalette();
              }
            }
            if (e.key === 'Escape' && commandPalette.style.display !== 'none') {
              closeCommandPalette();
            }
          });

          // ── Command bar (centered, wider, directly typeable) ──
          const commandBarWrapper = document.createElement("div");
          commandBarWrapper.id = "luigi-command-bar-wrapper";
          commandBarWrapper.style.cssText = `
            position:absolute; left:50%; transform:translateX(-50%);
            display:flex; align-items:center; justify-content:center;
            height:48px; pointer-events:none;
          `;

          const commandBar = document.createElement("div");
          commandBar.id = "luigi-command-bar";
          commandBar.style.cssText = `
            display:flex; align-items:center; gap:8px;
            background:#f4f4f5; border:1px solid #e4e4e7;
            border-radius:8px; padding:6px 12px;
            transition:background 0.15s, border-color 0.15s, box-shadow 0.15s;
            height:36px; width:420px; pointer-events:auto;
          `;
          commandBar.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
              <circle cx="11" cy="11" r="8"/>
              <path d="m21 21-4.3-4.3"/>
            </svg>
            <input id="command-bar-input" type="text" placeholder="Search systems, models, or navigate..." style="
              flex:1; border:none; outline:none; background:transparent;
              font-size:13px; color:#374151; min-width:0;
              font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
            " autocomplete="off" />
            <span style="
              flex-shrink:0; display:inline-flex; align-items:center; gap:2px;
              background:#e4e4e7; border-radius:4px; padding:2px 6px;
              font-size:11px; font-weight:500; color:#71717a;
              font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
            ">⌘K</span>
          `;

          const commandBarInput = commandBar.querySelector('#command-bar-input');

          commandBar.addEventListener("mouseenter", () => {
            const d = document.documentElement.classList.contains('dark');
            commandBar.style.background = d ? 'rgba(255,255,255,0.1)' : '#ebebeb';
            commandBar.style.borderColor = d ? 'rgba(255,255,255,0.15)' : '#d4d4d8';
          });
          commandBar.addEventListener("mouseleave", () => {
            if (document.activeElement !== commandBarInput) {
              const d = document.documentElement.classList.contains('dark');
              commandBar.style.background = d ? 'rgba(255,255,255,0.05)' : '#f4f4f5';
              commandBar.style.borderColor = d ? 'rgba(255,255,255,0.08)' : '#e4e4e7';
            }
          });

          // Focus styles
          commandBarInput.addEventListener("focus", () => {
            const d = document.documentElement.classList.contains('dark');
            commandBar.style.background = d ? 'rgba(255,255,255,0.08)' : '#ffffff';
            commandBar.style.borderColor = '#1147E9';
            commandBar.style.boxShadow = '0 0 0 3px rgba(17,71,233,0.1)';
          });
          commandBarInput.addEventListener("blur", () => {
            const d = document.documentElement.classList.contains('dark');
            commandBar.style.background = d ? 'rgba(255,255,255,0.05)' : '#f4f4f5';
            commandBar.style.borderColor = d ? 'rgba(255,255,255,0.08)' : '#e4e4e7';
            commandBar.style.boxShadow = 'none';
          });

          // Open palette on input focus/typing or ⌘K
          commandBarInput.addEventListener("keydown", (e) => {
            if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              const val = commandBarInput.value;
              commandBarInput.value = '';
              commandBarInput.blur();
              openCommandPalette();
              if (val) {
                document.getElementById('command-input').value = val;
                searchCommand(val);
              }
            }
          });
          commandBarInput.addEventListener("input", (e) => {
            // Open palette and transfer search query
            const val = commandBarInput.value;
            if (val.length >= 1) {
              commandBarInput.value = '';
              commandBarInput.blur();
              openCommandPalette();
              document.getElementById('command-input').value = val;
              searchCommand(val);
            }
          });

          commandBarWrapper.appendChild(commandBar);

          // ── AI Assistant button ──
          const aiBtn = document.createElement("button");
          aiBtn.id = "luigi-ai-assistant";
          aiBtn.style.cssText = `
            display:inline-flex; align-items:center; gap:6px;
            background:linear-gradient(135deg, #1147E9 0%, #6C1AF4 100%);
            border:none; border-radius:8px; padding:0 14px;
            color:#ffffff; font-size:13px; font-weight:500;
            font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
            cursor:pointer; height:36px; margin-right:12px;
            transition:opacity 0.15s, transform 0.1s;
            box-shadow:0 1px 2px rgba(17,71,233,0.15);
          `;
          aiBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 3v4m0 14v-4m9-5h-4M7 12H3m15.36-5.36-2.83 2.83m-5.06 5.06-2.83 2.83m0-10.72 2.83 2.83m5.06 5.06 2.83 2.83"/>
            </svg>
            <span>AI Assistant</span>
          `;
          aiBtn.addEventListener("mouseenter", () => { aiBtn.style.opacity = "0.9"; });
          aiBtn.addEventListener("mouseleave", () => { aiBtn.style.opacity = "1"; });
          aiBtn.addEventListener("click", () => {
            // TODO: Open AI Assistant panel
            console.log("AI Assistant clicked");
          });

          // ── Alerts bell (only if user has alerts permission) ──
          let bell = null;
          if (canReadAlerts) {
            bell = document.createElement("button");
            bell.id = "luigi-alerts-bell";
            bell.style.cssText = `
              position:relative; display:inline-flex; align-items:center; justify-content:center;
              width:32px; height:36px; background:transparent; border:none;
              border-radius:6px; cursor:pointer; color:#374151; margin-right:12px; margin-top:3px;
              flex-shrink:0; align-self:center;
            `;
            bell.innerHTML = `
              <span class="sap-icon sap-icon--bell" style="font-size:20px; pointer-events:none;"></span>
              <span id="luigi-alerts-count" style="
                display:none; position:absolute; top:1px; right:1px;
                min-width:15px; height:15px; background:#dc2626; color:#fff;
                font-size:9px; font-weight:700; line-height:1; border-radius:8px;
                padding:0 3px; align-items:center; justify-content:center;
              "></span>
            `;
            bell.addEventListener("click", () => { window.location.hash = "#/home/alerts"; });
            bell.addEventListener("mouseenter", () => { bell.style.background = document.documentElement.classList.contains('dark') ? 'rgba(255,255,255,0.07)' : '#f3f4f6'; });
            bell.addEventListener("mouseleave", () => { bell.style.background = "transparent"; });

            async function fetchAlertCount() {
              try {
                const res = await fetch("/api/alerts/v1/count", { cache: "no-store" });
                if (res.ok) {
                  const data = await res.json();
                  const count = data.count ?? 0;
                  const badge = document.getElementById("luigi-alerts-count");
                  if (badge) {
                    badge.textContent = count > 99 ? "99+" : String(count);
                    badge.style.display = count > 0 ? "inline-flex" : "none";
                  }
                }
              } catch {}
            }
            fetchAlertCount();
            setInterval(fetchAlertCount, 30000);
          }

          // ── User account chip ──
          const wrapper = document.createElement("div");
          wrapper.style.cssText = "position:relative; display:inline-flex; align-items:center; height:36px; align-self:center; margin-right:8px;";

          const trigger = document.createElement("button");
          trigger.style.cssText = `
            display:inline-flex; align-items:center; gap:8px;
            background:transparent; border:1px solid transparent;
            border-radius:8px; padding:2px 8px 2px 2px;
            color:#374151; font-size:13px; font-weight:500;
            font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
            cursor:pointer; height:36px; transition:background 0.15s, border-color 0.15s;
          `;
          trigger.innerHTML = `
            <span style="
              width:28px; height:28px; border-radius:50%;
              background:linear-gradient(135deg, #1147E9 0%, #6C1AF4 100%); display:inline-flex;
              align-items:center; justify-content:center;
              font-size:10px; font-weight:700; flex-shrink:0; color:#ffffff;
              letter-spacing:0.04em;
            ">${initials}</span>
            <span style="display:flex; flex-direction:column; align-items:flex-start; min-width:0;">
              <span style="max-width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; line-height:1.2;">${displayName}</span>
              ${roleLabel ? `<span style="font-size:11px; font-weight:400; color:#9ca3af; max-width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; line-height:1.2;">${roleLabel}</span>` : ""}
            </span>
            <span class="sap-icon sap-icon--slim-arrow-down" style="font-size:10px; color:#9ca3af; margin-left:-2px; flex-shrink:0;"></span>
          `;

          const dropdown = document.createElement("div");
          dropdown.id = 'luigi-account-dropdown';
          dropdown.style.cssText = `
            display:none; position:absolute; top:calc(100% + 8px); right:0;
            background:#ffffff; border:1px solid #e4e4e7; border-radius:10px;
            box-shadow:0 8px 24px rgba(0,0,0,0.10), 0 2px 6px rgba(0,0,0,0.06);
            min-width:200px; z-index:9999; overflow:hidden;
          `;
          dropdown.innerHTML = `
            <div style="padding:12px 14px 10px; display:flex; align-items:center; gap:10px;">
              <span style="
                width:34px; height:34px; border-radius:50%; flex-shrink:0;
                background:linear-gradient(135deg, #1147E9 0%, #6C1AF4 100%); display:inline-flex;
                align-items:center; justify-content:center;
                font-size:12px; font-weight:700; color:#ffffff; letter-spacing:0.04em;
              ">${initials}</span>
              <div style="min-width:0;">
                <div class="lui-name" style="font-size:13px; font-weight:600; color:#111827; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${displayName}</div>
                <div style="font-size:11px; color:#9ca3af; margin-top:1px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${currentUser.username}</div>
              </div>
            </div>
            <div class="lui-divider" style="height:1px; background:#f3f4f6; margin:0 4px;"></div>
            <div style="padding:4px;">
              <a href="/oauth2/sign_out?rd=/oauth2/sign_in" style="
                display:flex; align-items:center; gap:8px;
                padding:8px 10px; color:#374151; text-decoration:none;
                font-size:13px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
                border-radius:6px; transition:background 0.1s;
              "
              onmouseover="this.style.background=document.documentElement.classList.contains('dark')?'rgba(255,255,255,0.07)':'#f4f4f5'"
              onmouseout="this.style.background='transparent'">
                <span class="sap-icon sap-icon--log" style="font-size:14px; color:#9ca3af;"></span>
                Sign out
              </a>
            </div>
          `;

          trigger.addEventListener("click", (e) => {
            e.stopPropagation();
            dropdown.style.display = dropdown.style.display === "none" ? "block" : "none";
          });
          document.addEventListener("click", () => { dropdown.style.display = "none"; });
          trigger.addEventListener("mouseenter", () => { const d = document.documentElement.classList.contains('dark'); trigger.style.background = d ? 'rgba(255,255,255,0.07)' : '#f4f4f5'; trigger.style.borderColor = d ? 'rgba(255,255,255,0.08)' : '#e4e4e7'; });
          trigger.addEventListener("mouseleave", () => { trigger.style.background = "transparent"; trigger.style.borderColor = "transparent"; });

          // ── Dark mode toggle ──
          const THEME_KEY = 'trust-platform-theme';
          const darkToggle = document.createElement('button');
          darkToggle.setAttribute('aria-label', 'Toggle dark mode');
          darkToggle.style.cssText = `
            position:relative; display:inline-flex; align-items:center; justify-content:center;
            width:32px; height:36px; background:transparent; border:none;
            border-radius:6px; cursor:pointer; margin-right:4px; margin-top:3px;
            flex-shrink:0; align-self:center;
          `;

          function applyShellTheme(dark, broadcast = true) {
            document.documentElement.classList.toggle('dark', dark);
            // Broadcast theme change to all MFE iframes
            if (broadcast) {
              try {
                Luigi.customMessages().sendToAll({ id: 'theme-changed', theme: dark ? 'dark' : 'light' });
              } catch (e) {
                console.warn('Failed to broadcast theme change to MFEs:', e);
              }
            }
            let ov = document.getElementById('luigi-dark-overrides');
            if (dark) {
              if (!ov) { ov = document.createElement('style'); ov.id = 'luigi-dark-overrides'; document.head.appendChild(ov); }
              ov.textContent = `
                .fd-shellbar { background: #0f172a !important; border-bottom: none !important; }
                html, body { background: #09090b !important; }
                .fd-app, .lui-app, #app {
                  background: linear-gradient(to right, #0f172a 256px, #09090b 256px) !important;
                }
                body.semiCollapsed .fd-app, body.semiCollapsed .lui-app, body.semiCollapsed #app {
                  background: linear-gradient(to right, #0f172a 48px, #09090b 48px) !important;
                }
                .fd-shell, .fd-shell__content, .fd-shell__body,
                .fd-app__main, .fd-app__main-container,
                [class*="app__main"], [class*="main-container"], [class*="main-frame"] {
                  background: #09090b !important;
                }
                #luigi-account-dropdown { background: #18181b !important; border-color: rgba(255,255,255,0.08) !important; box-shadow: 0 8px 24px rgba(0,0,0,0.5), 0 2px 6px rgba(0,0,0,0.3) !important; }
                #luigi-account-dropdown .lui-name { color: #f9fafb !important; }
                #luigi-account-dropdown .lui-divider { background: rgba(255,255,255,0.08) !important; }
                #luigi-account-dropdown a { color: #e2e8f0 !important; }
              `;
            } else {
              if (ov) ov.remove();
            }
            const moonSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;
            const sunSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`;
            darkToggle.innerHTML = dark ? sunSvg : moonSvg;
            darkToggle.style.color = dark ? '#94a3b8' : '#374151';
            if (bell) bell.style.color = dark ? '#94a3b8' : '#374151';
            trigger.style.color = dark ? '#e2e8f0' : '#374151';
          }

          applyShellTheme(localStorage.getItem(THEME_KEY) === 'dark');

          darkToggle.addEventListener('click', () => {
            const nowDark = !document.documentElement.classList.contains('dark');
            localStorage.setItem(THEME_KEY, nowDark ? 'dark' : 'light');
            applyShellTheme(nowDark);
          });
          darkToggle.addEventListener('mouseenter', () => { darkToggle.style.background = document.documentElement.classList.contains('dark') ? 'rgba(255,255,255,0.07)' : '#f3f4f6'; });
          darkToggle.addEventListener('mouseleave', () => { darkToggle.style.background = 'transparent'; });

          wrapper.appendChild(trigger);
          wrapper.appendChild(dropdown);
          shellbar.prepend(wrapper);
          if (bell) shellbar.prepend(bell);
          shellbar.prepend(darkToggle);
          shellbar.prepend(aiBtn);
          shellbar.appendChild(commandBarWrapper);

          // Update command bar styling for dark mode
          function updateCommandBarTheme() {
            const d = document.documentElement.classList.contains('dark');
            commandBar.style.background = d ? 'rgba(255,255,255,0.05)' : '#f4f4f5';
            commandBar.style.borderColor = d ? 'rgba(255,255,255,0.08)' : '#e4e4e7';
            commandBarInput.style.color = d ? '#e2e8f0' : '#374151';
            const kbd = commandBar.querySelector('span:last-child');
            if (kbd) {
              kbd.style.background = d ? 'rgba(255,255,255,0.1)' : '#e4e4e7';
              kbd.style.color = d ? '#9ca3af' : '#71717a';
            }
          }
          updateCommandBarTheme();
          // Re-apply on dark mode toggle
          const origApplyShellTheme = applyShellTheme;
          // Watch for class changes on html element
          new MutationObserver(updateCommandBarTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        }
      }, 200);
    },
  },
  });
})();

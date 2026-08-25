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
  };
  const canSee = (seg) =>
    !PAGE_PERMISSIONS[seg] || PAGE_PERMISSIONS[seg].some((p) => permissions.includes(p));

  const children = [
      {
        pathSegment: "overview",
        label: "Overview",
        icon: "home",
        viewUrl: "http://localhost:8080/overview/",
        navigationContext: "overview",
      },
      {
        pathSegment: "ai-system-registry",
        label: "AI System Registry",
        icon: "database",
        viewUrl: "http://localhost:8080/registry/",
        navigationContext: "ai-system-registry",
      },
      {
        pathSegment: "decision-trace-analyzer",
        label: "Trace Explorer",
        icon: "detail-view",
        viewUrl: "http://localhost:8080/dta/",
        navigationContext: "decision-trace-analyzer",
      },
      {
        pathSegment: "monitoring",
        label: "Monitoring",
        icon: "line-chart",
        viewUrl: "http://localhost:8080/monitoring/",
        navigationContext: "monitoring",
      },
      {
        pathSegment: "alerts",
        label: "Alerts",
        icon: "alert",
        viewUrl: "http://localhost:8080/alerts/",
        navigationContext: "alerts",
      },
      {
        pathSegment: "assessments",
        label: "Assessments",
        icon: "task",
        viewUrl: "http://localhost:8080/compliance/#/assessments",
        navigationContext: "assessments",
      },
      {
        pathSegment: "obligations",
        label: "Obligations",
        icon: "checklist-item",
        viewUrl: "http://localhost:8080/compliance/#/obligations",
        navigationContext: "obligations",
      },
      {
        pathSegment: "controls",
        label: "Controls",
        icon: "shield",
        viewUrl: "http://localhost:8080/compliance/#/controls",
        navigationContext: "controls",
      },
      {
        pathSegment: "evidence",
        label: "Evidence",
        icon: "attachment",
        viewUrl: "http://localhost:8080/compliance/#/evidence",
        navigationContext: "evidence",
      },
      {
        pathSegment: "users",
        label: "Users & Roles",
        icon: "employee",
        viewUrl: "http://localhost:8080/users/",
        navigationContext: "users",
        viewGroup: "users",
      },
  ].filter((node) => canSee(node.pathSegment));

  Luigi.setConfig({
  navigation: {
    nodes: [
      {
        pathSegment: "home",
        label: "Home",
        hideFromNav: true,
        defaultChildNode: "overview",
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
        .fd-shellbar__branding:hover { background: #f3f4f6 !important; }
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
        .lui-main-app-frame,
        iframe#app-iframe,
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
        body, .fd-app, .lui-app, #app {
          background: #ffffff !important;
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
        }
        .brand-logo-full {
          height: 30px !important;
          display: block !important;
        }
        .brand-logo-icon {
          width: 30px !important;
          height: 30px !important;
          display: none !important;
        }
        body.semiCollapsed .brand-logo-full {
          display: none !important;
        }
        body.semiCollapsed .brand-logo-icon {
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

        /* ── Collapse button ── */
        #luigi-collapse-btn {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: auto;
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
        const imgIcon = document.createElement("img");
        imgIcon.src = "/brand/svg/Icon_color.svg";
        imgIcon.alt = "AI Trust";
        imgIcon.className = "brand-logo-icon";
        icon.appendChild(imgFull);
        icon.appendChild(imgIcon);
        branding.appendChild(icon);
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

          // ── Alerts bell ──
          const bell = document.createElement("button");
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
          bell.addEventListener("mouseenter", () => { bell.style.background = "#f3f4f6"; });
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
                <div style="font-size:13px; font-weight:600; color:#111827; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${displayName}</div>
                <div style="font-size:11px; color:#9ca3af; margin-top:1px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${currentUser.username}</div>
              </div>
            </div>
            <div style="height:1px; background:#f3f4f6; margin:0 4px;"></div>
            <div style="padding:4px;">
              <a href="/oauth2/sign_out" style="
                display:flex; align-items:center; gap:8px;
                padding:8px 10px; color:#374151; text-decoration:none;
                font-size:13px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
                border-radius:6px; transition:background 0.1s;
              "
              onmouseover="this.style.background='#f4f4f5'"
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
          trigger.addEventListener("mouseenter", () => { trigger.style.background = "#f4f4f5"; trigger.style.borderColor = "#e4e4e7"; });
          trigger.addEventListener("mouseleave", () => { trigger.style.background = "transparent"; trigger.style.borderColor = "transparent"; });

          wrapper.appendChild(trigger);
          wrapper.appendChild(dropdown);
          shellbar.prepend(wrapper);
          shellbar.prepend(bell);
        }
      }, 200);
    },
  },
  });
})();

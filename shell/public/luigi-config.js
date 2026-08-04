// Fetch the current user's permissions before building the nav so that each
// nav node is only shown to users who hold at least one of its permissions.
// A page a role has no permission for at all (e.g. Executive → Alerts/Evidence)
// is hidden entirely rather than shown with everything greyed out.
// The check is UX-only; every backend enforces permissions independently.
(async function initShell() {
  let permissions = [];
  try {
    const res = await fetch("/api/registry/v1/me/permissions", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      permissions = data.permissions || [];
    }
  } catch (e) {
    // If the permissions endpoint is unreachable, fail closed: only nodes
    // without a permission requirement (Overview) remain visible.
    permissions = [];
  }

  // pathSegment → permissions that make the node visible (ANY of them suffices).
  // A pathSegment absent from this map is always visible (e.g. "overview").
  const PAGE_PERMISSIONS = {
    "ai-system-registry": ["systems:read", "systems:write"],
    "decision-trace-analyzer": ["monitoring:read"],
    "monitoring": ["monitoring:read"],
    "alerts": ["alerts:read", "alerts:handle", "alerts:manage_rules"],
    "assessments": ["assessments:read", "assessments:write", "assessments:approve"],
    "obligations": ["assessments:read", "assessments:write", "assessments:approve"],
    "controls": ["assessments:read", "assessments:write", "assessments:approve"],
    "evidence": ["evidence:read", "evidence:write", "evidence:approve"],
    "iam": ["iam:manage"],
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
      },
      {
        pathSegment: "iam",
        label: "Role Management",
        icon: "person-placeholder",
        viewUrl: "http://localhost:8080/iam/",
        navigationContext: "iam",
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
      title: "AI Trust Platform",
    },
    responsiveNavigation: "Fiori3",
    sideNavigation: {
      collapsed: true,
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
    },
  },

  lifecycleHooks: {
    luigiAfterInit: () => {
      const style = document.createElement("style");
      style.textContent = `:root {
          --luigi-nav-bg: #ffffff;
          --luigi-nav-width: 256px;
        }

        /* ── Shell bar ── */
        .fd-shellbar {
          background: #0a6ed1 !important;
          border-bottom: none !important;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08) !important;
          height: 48px !important;
          padding-left: 0 !important;
        }
        .fd-shellbar__title,
        .lui-shellbar__title,
        .shellbar-title {
          color: #ffffff !important;
          font-family: "72", "72full", Arial, Helvetica, sans-serif !important;
          font-weight: 600 !important;
          font-size: 15px !important;
          line-height: 1 !important;
          display: inline-flex !important;
          align-items: center !important;
          height: auto !important;
          margin: 0 !important;
          padding: 0 !important;
          letter-spacing: 0 !important;
        }
        /* Hide the empty logo placeholder so the title isn't visually offset */
        .fd-shellbar__logo:empty,
        .fd-shellbar__logo--image-replaced {
          display: none !important;
        }
        /* Pull the left group (hamburger + home button) flush to the left edge */
        .fd-shellbar__group--product {
          padding-left: 0 !important;
          margin-left: 0 !important;
        }

        /* Shrink the home button to tightly wrap the title text */
        .fd-shellbar__branding {
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
          height: 32px !important;
          padding: 0 8px !important;
          background: transparent !important;
          cursor: pointer !important;
          outline: none !important;
          border-radius: 4px !important;
        }
        .fd-shellbar__branding:hover {
          background: rgba(255,255,255,0.10) !important;
        }
        .fd-shellbar__branding:focus {
          outline: none !important;
          box-shadow: none !important;
        }
        .fd-shellbar__branding:focus-visible {
          outline: 2px solid rgba(255, 255, 255, 0.8) !important;
          outline-offset: 2px !important;
          box-shadow: none !important;
        }

        /* ── Hamburger — white icon on the dark blue shellbar ── */
        .lui-burger,
        .fd-shellbar__button.lui-burger,
        button.fd-button--transparent.lui-burger {
          color: #ffffff !important;
          background: transparent !important;
          border: none !important;
          width: 36px !important;
          height: 36px !important;
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
          cursor: pointer !important;
          margin: 0 4px !important;
        }
        .lui-burger:hover {
          background: rgba(255,255,255,0.15) !important;
        }
        .lui-burger .sap-icon {
          color: #ffffff !important;
        }

        /* ── Sidebar ── */
        .fd-side-nav,
        .lui-side-nav,
        [class*="side-nav"],
        nav.fd-navigation,
        .lui-nav-container {
          background: #ffffff !important;
          border-right: 1px solid #e4e6e8 !important;
          box-shadow: none !important;
        }

        /* ── Nav items ── */
        .fd-navigation__list-item a,
        .lui-nav__item a,
        .lui-navigation-list-item a,
        li.fd-navigation__list-item a {
          color: #1d2d3e !important;
          font-weight: 400 !important;
          font-size: 14px !important;
          border-radius: 6px !important;
          margin: 1px 8px !important;
          padding: 8px 10px !important;
          background: transparent !important;
          border: none !important;
          transition: background 0.12s !important;
          display: flex !important;
          align-items: center !important;
          gap: 10px !important;
        }
        .fd-navigation__list-item a:hover,
        .lui-nav__item a:hover {
          background: #f5f6f7 !important;
          color: #0a6ed1 !important;
        }
        .fd-navigation__list-item--selected a,
        .lui-nav__item--selected a,
        .is-selected a,
        .lui-navigation-list-item.is-selected a {
          background: #e8f0fb !important;
          color: #0a6ed1 !important;
          font-weight: 500 !important;
        }
        .fd-navigation__list-item--selected::before,
        .lui-nav__item--selected::before,
        .is-selected::before {
          display: none !important;
        }
        .fd-navigation__icon,
        .lui-nav__icon,
        .sap-icon {
          color: #556b82 !important;
          font-size: 16px !important;
        }
        .is-selected .sap-icon,
        .fd-navigation__list-item--selected .sap-icon {
          color: #0a6ed1 !important;
        }

        /* ── App / iframe ── */
        .lui-main-app-frame,
        iframe#app-iframe,
        .fd-app__main {
          background: #f5f6f7 !important;
          border: none !important;
        }
        body, .fd-app, .lui-app {
          background: #f5f6f7 !important;
        }
        .lui-side-nav--collapsed,
        .lui-side-nav {
          background: #ffffff !important;
        }

        /* ── Collapsed: icons only, centered ── */
        .lui-side-nav--collapsed .fd-navigation__list-item a,
        .lui-side-nav--collapsed .lui-nav__item a {
          justify-content: center !important;
          padding: 10px !important;
          margin: 2px 6px !important;
        }
        .lui-side-nav--collapsed .fd-navigation__text,
        .lui-side-nav--collapsed .lui-nav__label,
        .lui-side-nav--collapsed span:not(.sap-icon):not(.fd-navigation__icon) {
          display: none !important;
        }
        .lui-side-nav--collapsed .sap-icon,
        .lui-side-nav--collapsed .fd-navigation__icon {
          font-size: 18px !important;
          margin: 0 !important;
        }

        /* ── Sidebar tooltip ── */
        #luigi-nav-tooltip {
          position: fixed;
          background: #1d2d3e;
          color: #ffffff;
          padding: 6px 10px;
          border-radius: 4px;
          font-size: 13px;
          font-weight: 500;
          white-space: nowrap;
          pointer-events: none;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
          z-index: 9999;
          display: none;
        }
      `;
      document.head.appendChild(style);

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

      // Inject sign-out button into shell bar
      const waitForShellbar = setInterval(() => {
        const shellbar = document.querySelector(".fd-shellbar__group--actions, .fd-shellbar__actions");
        if (shellbar) {
          clearInterval(waitForShellbar);
          const btn = document.createElement("a");
          btn.href = "/oauth2/sign_out";
          btn.title = "Sign out";
          btn.style.cssText = `
            display: inline-flex; align-items: center; gap: 6px;
            color: #ffffff; text-decoration: none; font-size: 13px;
            font-weight: 500; padding: 6px 12px; border-radius: 4px;
            border: 1px solid rgba(255,255,255,0.4);
            margin-right: 8px; cursor: pointer;
          `;
          btn.innerHTML = `<span class="sap-icon sap-icon--log" style="font-size:16px;color:#fff"></span> Sign out`;
          btn.addEventListener("mouseenter", () => btn.style.background = "rgba(255,255,255,0.15)");
          btn.addEventListener("mouseleave", () => btn.style.background = "transparent");
          shellbar.prepend(btn);
        }
      }, 200);
    },
  },
  });
})();

Luigi.setConfig({
  navigation: {
    nodes: [
      {
        pathSegment: "home",
        label: "Home",
        hideFromNav: true,
        defaultChildNode: "overview",
        children: [
          {
            pathSegment: "overview",
            label: "Overview",
            icon: "home",
            viewUrl: "http://localhost:3003/",
            navigationContext: "overview",
          },
          {
            pathSegment: "ai-system-registry",
            label: "AI System Registry",
            icon: "database",
            viewUrl: "http://localhost:3001/",
            navigationContext: "ai-system-registry",
          },
          {
            pathSegment: "monitoring",
            label: "Monitoring",
            icon: "line-chart",
            viewUrl: "http://localhost:3002/",
            navigationContext: "monitoring",
          },
          {
            pathSegment: "alerts",
            label: "Alerts",
            hideFromNav: true,
            viewUrl: "http://localhost:3004/",
            navigationContext: "alerts",
          },
        ],
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
  },

  lifecycleHooks: {
    luigiAfterInit: () => {
      const style = document.createElement("style");
      style.textContent = `
        :root {
          --luigi-nav-bg: #ffffff;
          --luigi-nav-width: 256px;
        }

        /* ── Shell bar ── */
        .fd-shellbar,
        .lui-shellbar,
        [class*="shellbar"] {
          background: #0a6ed1 !important;
          border-bottom: none !important;
          box-shadow: none !important;
          height: 48px !important;
        }
        .fd-shellbar__title,
        .lui-shellbar__title,
        .shellbar-title {
          color: #ffffff !important;
          font-weight: 600 !important;
          font-size: 15px !important;
        }

        /* ── Hamburger — make it obvious ── */
        .lui-burger,
        .fd-shellbar__hamburger,
        button[aria-label="Navigation"],
        button.fd-button--transparent.lui-burger,
        .fd-shellbar .fd-button {
          color: #ffffff !important;
          background: rgba(255,255,255,0.15) !important;
          border: 1px solid rgba(255,255,255,0.3) !important;
          border-radius: 6px !important;
          width: 36px !important;
          height: 36px !important;
          display: inline-flex !important;
          align-items: center !important;
          justify-content: center !important;
          cursor: pointer !important;
          margin: 0 8px !important;
        }
        .lui-burger:hover,
        .fd-shellbar__hamburger:hover {
          background: rgba(255,255,255,0.25) !important;
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

        /* ── Hide Luigi's native hamburger — we inject our own ── */
        .lui-burger,
        .fd-shellbar__hamburger,
        button[aria-label="Navigation"],
        button.fd-button--transparent.lui-burger {
          display: none !important;
        }

        /* ── Make sidebar a flex column so hamburger sits above nav naturally ── */
        .lui-side-nav,
        .fd-side-nav {
          display: flex !important;
          flex-direction: column !important;
          position: relative !important;
        }

        /* ── Custom hamburger button at top of sidebar ── */
        #custom-hamburger {
          width: 100%;
          height: 48px;
          min-height: 48px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          border-bottom: 1px solid #e4e6e8;
          background: #ffffff;
          flex-shrink: 0;
          order: -1;
        }
        #custom-hamburger:hover { background: #f5f6f7; }
        #custom-hamburger .hb {
          width: 20px; height: 16px;
          display: flex; flex-direction: column; justify-content: space-between;
        }
        #custom-hamburger .hb span {
          display: block; height: 2px; width: 100%;
          background: #556b82; border-radius: 2px;
          transition: all 0.25s ease; transform-origin: center;
        }
        #custom-hamburger.open .hb span:nth-child(1) { transform: translateY(7px) rotate(45deg); }
        #custom-hamburger.open .hb span:nth-child(2) { opacity: 0; transform: scaleX(0); }
        #custom-hamburger.open .hb span:nth-child(3) { transform: translateY(-7px) rotate(-45deg); }
        #custom-hamburger:hover .hb span { background: #0a6ed1; }
      `;
      document.head.appendChild(style);

      const LUIGI_NAV_KEY = "luigi.preferences.navigation.collapsedNavigation";

      // Inject custom hamburger into sidebar once Luigi has rendered
      function injectHamburger() {
        const sidebar = document.querySelector(
          '.lui-side-nav, .fd-side-nav, [class*="side-nav"]'
        );
        if (!sidebar || document.getElementById("custom-hamburger")) return;

        const btn = document.createElement("div");
        btn.id = "custom-hamburger";
        btn.innerHTML = `<div class="hb"><span></span><span></span><span></span></div>`;

        // Read Luigi's actual current collapsed state
        let collapsed = localStorage.getItem(LUIGI_NAV_KEY) === "true";
        // "open" class = expanded (X icon), no "open" = collapsed (3 lines)
        btn.classList.toggle("open", !collapsed);

        btn.addEventListener("click", () => {
          collapsed = !collapsed;
          btn.classList.toggle("open", !collapsed);

          // Toggle Luigi's collapsed state
          const luigiBtn = document.querySelector(
            '.lui-burger, button[aria-label="Navigation"]'
          );
          if (luigiBtn) {
            luigiBtn.click();
          } else {
            sidebar.classList.toggle("lui-side-nav--collapsed", collapsed);
          }
        });

        sidebar.style.position = "relative";
        sidebar.insertBefore(btn, sidebar.firstChild);
      }

      // Retry until sidebar is in DOM
      const interval = setInterval(() => {
        const sidebar = document.querySelector('.lui-side-nav, .fd-side-nav');
        if (sidebar) {
          injectHamburger();
          clearInterval(interval);
        }
      }, 200);
    },
  },
});

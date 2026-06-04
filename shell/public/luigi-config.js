Luigi.setConfig({
  navigation: {
    nodes: [
      {
        pathSegment: "home",
        label: "Home",
        hideFromNav: true,
        children: [
          {
            pathSegment: "ai-system-registry",
            label: "AI System Registry",
            icon: "database",
            viewUrl: "http://localhost:3001/",
            navigationContext: "ai-system-registry",
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
    responsiveNavigation: "simpleMobileOnly",
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
        .fd-side-nav,
        .lui-side-nav,
        [class*="side-nav"],
        nav.fd-navigation,
        .lui-nav-container {
          background: #ffffff !important;
          border-right: 1px solid #e4e6e8 !important;
          box-shadow: none !important;
        }
        .fd-navigation__list-item a,
        .lui-nav__item a,
        .fd-navigation__item,
        [class*="nav-item"],
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
        }
        .fd-navigation__list-item a:hover,
        .lui-nav__item a:hover,
        [class*="nav-item"]:hover a {
          background: #f5f6f7 !important;
          color: #0a6ed1 !important;
        }
        .fd-navigation__list-item--selected a,
        .lui-nav__item--selected a,
        .is-selected a,
        [class*="selected"] a,
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
        [class*="nav-icon"],
        .sap-icon {
          color: #556b82 !important;
          font-size: 16px !important;
        }
        .is-selected .sap-icon,
        .fd-navigation__list-item--selected .sap-icon {
          color: #0a6ed1 !important;
        }
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
      `;
      document.head.appendChild(style);
    },
  },
});

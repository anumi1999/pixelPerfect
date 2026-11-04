import React, { useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Command,
  CreditCard,
  Download,
  FileText,
  Filter,
  LayoutDashboard,
  LifeBuoy,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  ShoppingBag,
  Sparkles,
  Target,
  Users,
  Wallet,
  Zap,
  Menu,
  X,
  Globe2,
  CheckCircle2,
  Clock3,
  AlertCircle,
} from "lucide-react";

const nav = [
  { label: "Overview", icon: LayoutDashboard, active: true },
  { label: "Analytics", icon: Activity },
  { label: "Campaigns", icon: Target, badge: "4" },
  { label: "Audience", icon: Users },
  { label: "Transactions", icon: CreditCard },
];
const campaigns = [
  {
    name: "Summer collection launch",
    channel: "Instagram · Paid social",
    initials: "SC",
    color: "violet",
    spend: "$8,420",
    revenue: "$24,890",
    roas: "2.96x",
    progress: 78,
    status: "Active",
  },
  {
    name: "Always-on search",
    channel: "Google · Search",
    initials: "AS",
    color: "blue",
    spend: "$5,180",
    revenue: "$18,240",
    roas: "3.52x",
    progress: 62,
    status: "Active",
  },
  {
    name: "October newsletter",
    channel: "Email · Lifecycle",
    initials: "ON",
    color: "orange",
    spend: "$1,240",
    revenue: "$9,680",
    roas: "7.81x",
    progress: 91,
    status: "Active",
  },
  {
    name: "Retargeting — visitors",
    channel: "Meta · Display",
    initials: "RT",
    color: "green",
    spend: "$3,760",
    revenue: "$7,120",
    roas: "1.89x",
    progress: 39,
    status: "Learning",
  },
];
const activity = [
  {
    icon: CheckCircle2,
    color: "green",
    title: "Campaign reached its goal",
    detail: "Summer collection · 12 min ago",
  },
  {
    icon: Users,
    color: "blue",
    title: "New audience segment created",
    detail: "High-intent shoppers · 1 hr ago",
  },
  {
    icon: AlertCircle,
    color: "orange",
    title: "Budget running low",
    detail: "Retargeting campaign · 3 hrs ago",
  },
];

function Sidebar({ open, setOpen }) {
  return (
    <>
      <div
        className={`mobile-scrim ${open ? "show" : ""}`}
        onClick={() => setOpen(false)}
      />
      <aside className={`sidebar ${open ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark">
            <Activity size={19} />
          </div>
          <span>NOVA</span>
          <span className="brand-pro">PRO</span>
          <button className="mobile-close" onClick={() => setOpen(false)}>
            <X size={18} />
          </button>
        </div>
        <button className="workspace">
          <div className="workspace-avatar">A</div>
          <span>
            <b>Acme Studio</b>
            <small>Growth workspace</small>
          </span>
          <ChevronDown size={15} />
        </button>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {nav.map((n) => (
            <a key={n.label} className={`nav-item ${n.active ? "active" : ""}`}>
              <n.icon size={18} />
              <span>{n.label}</span>
              {n.badge && <em>{n.badge}</em>}
            </a>
          ))}
        </nav>
        <div className="nav-label tools-label">TOOLS</div>
        <nav>
          <a className="nav-item">
            <FileText size={18} />
            <span>Reports</span>
          </a>
          <a className="nav-item">
            <ShoppingBag size={18} />
            <span>Integrations</span>
            <span className="new-dot" />
          </a>
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card">
            <div className="help-icon">
              <Sparkles size={17} />
            </div>
            <b>Unlock your growth</b>
            <p>Get more insights with Nova AI.</p>
            <button>
              Explore features <ArrowUpRight size={13} />
            </button>
          </div>
          <a className="nav-item">
            <CircleHelp size={18} />
            <span>Help center</span>
          </a>
          <a className="nav-item">
            <Settings size={18} />
            <span>Settings</span>
          </a>
          <div className="profile">
            <div className="profile-avatar">MJ</div>
            <span>
              <b>Muskan Jain</b>
              <small>Admin account</small>
            </span>
            <MoreHorizontal size={18} />
          </div>
        </div>
      </aside>
    </>
  );
}
function Header({ setOpen }) {
  return (
    <header className="topbar">
      <button className="hamburger" onClick={() => setOpen(true)}>
        <Menu size={20} />
      </button>
      <div className="breadcrumbs">
        <span>Workspace</span>
        <ChevronRight size={14} />
        <b>Overview</b>
      </div>
      <div className="top-actions">
        <div className="searchbox">
          <Search size={16} />
          <span>Search anything...</span>
          <kbd>⌘ K</kbd>
        </div>
        <button className="icon-button">
          <Bell size={18} />
          <i />
        </button>
        <div className="top-avatar">MJ</div>
      </div>
    </header>
  );
}
function Metric({ title, value, change, positive, icon: Icon, caption }) {
  return (
    <article className="metric-card">
      <div className="metric-top">
        <span>{title}</span>
        <div className="metric-icon">
          <Icon size={17} />
        </div>
      </div>
      <div className="metric-value">{value}</div>
      <div className="metric-bottom">
        <span className={`trend ${positive ? "up" : "down"}`}>
          {positive ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}{" "}
          {change}
        </span>
        <span>{caption}</span>
      </div>
    </article>
  );
}
function RevenueChart() {
  const points =
    "0,118 38,105 76,111 114,79 152,88 190,57 228,69 266,40 304,54 342,26 380,43 418,16 456,30 494,8";
  return (
    <div className="chart-wrap">
      <div className="chart-y">
        <span>$30k</span>
        <span>$20k</span>
        <span>$10k</span>
        <span>$0</span>
      </div>
      <div className="chart-main">
        <div className="grid-lines">
          <i />
          <i />
          <i />
          <i />
        </div>
        <svg
          viewBox="0 0 494 145"
          preserveAspectRatio="none"
          className="chart-svg"
        >
          <defs>
            <linearGradient id="area" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#7565ed" stopOpacity=".25" />
              <stop offset="100%" stopColor="#7565ed" stopOpacity="0" />
            </linearGradient>
          </defs>
          <polygon points={`0,145 ${points} 494,145`} fill="url(#area)" />
          <polyline
            points={points}
            fill="none"
            stroke="#7665ed"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle
            cx="418"
            cy="16"
            r="5"
            fill="#fff"
            stroke="#7665ed"
            strokeWidth="3"
          />
        </svg>
        <div className="chart-x">
          <span>Oct 01</span>
          <span>Oct 05</span>
          <span>Oct 10</span>
          <span>Oct 15</span>
          <span>Oct 20</span>
          <span>Oct 25</span>
          <span>Oct 31</span>
        </div>
      </div>
    </div>
  );
}
function CampaignTable() {
  return (
    <section className="panel campaign-panel">
      <div className="panel-heading">
        <div>
          <h3>Top campaigns</h3>
          <p>Performance across your active campaigns</p>
        </div>
        <button className="text-button">
          View all <ArrowUpRight size={14} />
        </button>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>CAMPAIGN</th>
              <th>SPEND</th>
              <th>REVENUE</th>
              <th>ROAS</th>
              <th>STATUS</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c) => (
              <tr key={c.name}>
                <td>
                  <div className="campaign-name">
                    <div className={`campaign-avatar ${c.color}`}>
                      {c.initials}
                    </div>
                    <div>
                      <b>{c.name}</b>
                      <small>{c.channel}</small>
                    </div>
                  </div>
                </td>
                <td>{c.spend}</td>
                <td className="strong-cell">{c.revenue}</td>
                <td>
                  <b>{c.roas}</b>
                </td>
                <td>
                  <span
                    className={`status ${c.status === "Active" ? "active-status" : "learning-status"}`}
                  >
                    <i />
                    {c.status}
                  </span>
                </td>
                <td>
                  <button className="dots">
                    <MoreHorizontal size={17} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-footer">
        <span>
          Showing <b>4</b> of 18 campaigns
        </span>
        <div>
          <button className="page-arrow">
            <ChevronLeft size={15} />
          </button>
          <button className="page-number">1</button>
          <button className="page-arrow">
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
    </section>
  );
}
function SourcePanel() {
  return (
    <section className="panel source-panel">
      <div className="panel-heading">
        <div>
          <h3>Traffic sources</h3>
          <p>Where your visitors come from</p>
        </div>
        <button className="dots">
          <MoreHorizontal size={18} />
        </button>
      </div>
      <div className="source-content">
        <div className="donut">
          <div>
            <b>48.2k</b>
            <small>Visitors</small>
          </div>
        </div>
        <div className="source-legend">
          <div>
            <i className="purple" />
            <span>Organic search</span>
            <b>42%</b>
          </div>
          <div>
            <i className="blue" />
            <span>Social media</span>
            <b>28%</b>
          </div>
          <div>
            <i className="orange" />
            <span>Direct</span>
            <b>18%</b>
          </div>
          <div>
            <i className="gray" />
            <span>Referral</span>
            <b>12%</b>
          </div>
        </div>
      </div>
    </section>
  );
}
function ActivityPanel() {
  return (
    <section className="panel activity-panel">
      <div className="panel-heading">
        <div>
          <h3>Recent activity</h3>
          <p>Latest updates from your workspace</p>
        </div>
        <button className="dots">
          <MoreHorizontal size={18} />
        </button>
      </div>
      <div className="activity-list">
        {activity.map((a, i) => (
          <div className="activity-row" key={i}>
            <div className={`activity-icon ${a.color}`}>
              <a.icon size={16} />
            </div>
            <div>
              <b>{a.title}</b>
              <small>{a.detail}</small>
            </div>
          </div>
        ))}
      </div>
      <button className="activity-link">
        View activity log <ArrowUpRight size={14} />
      </button>
    </section>
  );
}
export default function App() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [period, setPeriod] = useState("Last 30 days");
  return (
    <div className="app-shell">
      <Sidebar open={mobileOpen} setOpen={setMobileOpen} />
      <main className="main-area">
        <Header setOpen={setMobileOpen} />
        <div className="content">
          <div className="page-title-row">
            <div>
              <div className="eyebrow">
                <span /> MONDAY, OCTOBER 31, 2026
              </div>
              <h1>
                Good morning, Muskan <span>✦</span>
              </h1>
              <p>Here's what's happening with your business today.</p>
            </div>
            <div className="title-actions">
              <button className="secondary-button">
                <CalendarDays size={16} />
                {period}
                <ChevronDown size={14} />
              </button>
              <button className="primary-button">
                <Download size={16} /> Export report
              </button>
            </div>
          </div>
          <div className="insight-banner">
            <div className="insight-spark">
              <Sparkles size={19} />
            </div>
            <div>
              <b>Your revenue is trending up 18.6% this month</b>
              <p>
                Campaigns are performing 12% better than your previous period.
                Keep the momentum going.
              </p>
            </div>
            <button>
              View insights <ArrowUpRight size={14} />
            </button>
            <button className="banner-close">
              <X size={16} />
            </button>
          </div>
          <div className="section-head">
            <div>
              <h2>Performance overview</h2>
              <span>Compared to previous 30 days</span>
            </div>
            <button className="filter-button">
              <Filter size={15} /> Filters
            </button>
          </div>
          <div className="metrics-grid">
            <Metric
              title="Total revenue"
              value="$84,254.00"
              change="18.6%"
              positive
              icon={Wallet}
              caption="vs. last month"
            />
            <Metric
              title="Total orders"
              value="2,420"
              change="12.8%"
              positive
              icon={ShoppingBag}
              caption="vs. last month"
            />
            <Metric
              title="Conversion rate"
              value="3.62%"
              change="0.4%"
              positive
              icon={Target}
              caption="vs. last month"
            />
            <Metric
              title="Active customers"
              value="18,492"
              change="2.4%"
              positive={false}
              icon={Users}
              caption="vs. last month"
            />
          </div>
          <div className="main-grid">
            <div className="left-column">
              <section className="panel revenue-panel">
                <div className="panel-heading">
                  <div>
                    <h3>Revenue overview</h3>
                    <p>Track how your revenue is growing over time</p>
                  </div>
                  <div className="chart-legend">
                    <i /> Revenue{" "}
                    <button className="dots">
                      <MoreHorizontal size={18} />
                    </button>
                  </div>
                </div>
                <div className="revenue-total">
                  <b>$84,254.00</b>
                  <span className="trend up">
                    <ArrowUpRight size={14} /> 18.6%
                  </span>
                  <small>vs. previous period</small>
                </div>
                <RevenueChart />
              </section>
              <CampaignTable />
            </div>
            <div className="right-column">
              <SourcePanel />
              <ActivityPanel />
              <section className="upgrade-card">
                <div className="upgrade-orb">
                  <Zap size={20} />
                </div>
                <div>
                  <b>Make smarter decisions</b>
                  <p>Unlock deeper insights with Nova AI recommendations.</p>
                </div>
                <button>
                  Explore Nova AI <ArrowUpRight size={14} />
                </button>
              </section>
            </div>
          </div>
          <footer className="footer">
            <span>© 2026 Nova Analytics</span>
            <span>
              <Globe2 size={13} /> All systems operational <i />
            </span>
            <span>
              Made for better decisions <Sparkles size={12} />
            </span>
          </footer>
        </div>
      </main>
    </div>
  );
}

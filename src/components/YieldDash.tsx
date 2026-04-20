/**
 * YieldDash.tsx
 * Bloomberg-terminal style dashboard for monitoring microsecond yield fluctuations.
 * Real-time visualization of arbitrage performance, bid flow, and yield optimization.
 */

import * as React from "react";
import type { ArbitrageMetrics } from "../services/ArbitrageEngine";
import type { AggregatedBid } from "../services/BidAggregator";

export interface YieldSnapshot {
  timestamp: number;
  totalYield: number;
  avgExecutionLatencyMs: number;
  bidVolume: number;
  topPerformingFormat: string;
  yieldVelocity: number;
}

export interface YieldDashProps {
  metrics: ArbitrageMetrics;
  recentBids: AggregatedBid[];
  snapshots: YieldSnapshot[];
  refreshIntervalMs?: number;
}

export interface YieldDashState {
  selectedTimeRange: "1m" | "5m" | "15m" | "1h";
  selectedMetric: "yield" | "latency" | "volume" | "format";
  liveFeed: boolean;
}

export class YieldDash extends React.Component<YieldDashProps, YieldDashState> {
  private refreshInterval: ReturnType<typeof setInterval> | null = null;

  constructor(props: YieldDashProps) {
    super(props);
    this.state = {
      selectedTimeRange: "5m",
      selectedMetric: "yield",
      liveFeed: true
    };
  }

  componentDidMount(): void {
    if (this.state.liveFeed && this.props.refreshIntervalMs) {
      this.startLiveFeed();
    }
  }

  componentWillUnmount(): void {
    this.stopLiveFeed();
  }

  render(): React.ReactElement {
    const { metrics, recentBids, snapshots } = this.props;
    const { selectedTimeRange, selectedMetric, liveFeed } = this.state;

    return React.createElement(
      "div",
      { className: "yield-dash-container", style: containerStyle },
      React.createElement(
        "div",
        { className: "yield-dash-header", style: headerStyle },
        React.createElement("h1", { style: titleStyle }, "Yield Dashboard"),
        React.createElement(
          "div",
          { className: "yield-dash-controls", style: controlsStyle },
          this.renderTimeRangeSelector(),
          this.renderMetricSelector(),
          this.renderLiveFeedToggle()
        )
      ),
      React.createElement(
        "div",
        { className: "yield-dash-grid", style: gridStyle },
        this.renderOverviewPanel(metrics),
        this.renderLatencyPanel(metrics),
        this.renderFormatDistributionPanel(metrics),
        this.renderYieldByFormatPanel(metrics)
      ),
      React.createElement(
        "div",
        { className: "yield-dash-charts", style: chartsStyle },
        this.renderTimeSeriesChart(snapshots, selectedMetric, selectedTimeRange),
        this.renderBidFlowTable(recentBids)
      )
    );
  }

  private renderOverviewPanel(metrics: ArbitrageMetrics): React.ReactElement {
    const yieldPerMatch = metrics.totalMatches > 0 ? metrics.totalYield / metrics.totalMatches : 0;

    return React.createElement(
      "div",
      { className: "yield-panel overview", style: panelStyle },
      React.createElement("h2", { style: panelTitleStyle }, "Overview"),
      React.createElement(
        "div",
        { className: "metric-grid", style: metricGridStyle },
        this.renderMetricCard("Total Matches", metrics.totalMatches.toLocaleString(), "matches"),
        this.renderMetricCard("Total Yield", `$${metrics.totalYield.toFixed(2)}`, "usd"),
        this.renderMetricCard("Avg Yield/Match", `$${yieldPerMatch.toFixed(4)}`, "usd"),
        this.renderMetricCard("Avg Latency", `${metrics.avgExecutionLatencyMs.toFixed(2)}ms`, "latency")
      )
    );
  }

  private renderLatencyPanel(metrics: ArbitrageMetrics): React.ReactElement {
    const latencyStatus = this.getLatencyStatus(metrics.avgExecutionLatencyMs);

    return React.createElement(
      "div",
      { className: "yield-panel latency", style: panelStyle },
      React.createElement("h2", { style: panelTitleStyle }, "Execution Latency"),
      React.createElement(
        "div",
        { className: "latency-display", style: latencyDisplayStyle },
        React.createElement(
          "div",
          { className: "latency-value", style: latencyValueStyle },
          `${metrics.avgExecutionLatencyMs.toFixed(4)}ms`
        ),
        React.createElement(
          "div",
          {
            className: `latency-status ${latencyStatus.level}`,
            style: { ...latencyStatusStyle, color: latencyStatus.color }
          },
          latencyStatus.label
        )
      ),
      React.createElement(
        "div",
        { className: "latency-bar", style: latencyBarContainerStyle },
        React.createElement("div", {
          className: "latency-bar-fill",
          style: {
            ...latencyBarFillStyle,
            width: `${Math.min((metrics.avgExecutionLatencyMs / 10) * 100, 100)}%`,
            backgroundColor: latencyStatus.color
          }
        })
      )
    );
  }

  private renderFormatDistributionPanel(metrics: ArbitrageMetrics): React.ReactElement {
    const total = Object.values(metrics.formatDistribution).reduce((sum, count) => sum + count, 0);

    return React.createElement(
      "div",
      { className: "yield-panel format-dist", style: panelStyle },
      React.createElement("h2", { style: panelTitleStyle }, "Format Distribution"),
      React.createElement(
        "div",
        { className: "format-list", style: formatListStyle },
        ...Object.entries(metrics.formatDistribution).map(([format, count]) => {
          const percentage = total > 0 ? (count / total) * 100 : 0;
          return this.renderFormatBar(format, count, percentage);
        })
      )
    );
  }

  private renderYieldByFormatPanel(metrics: ArbitrageMetrics): React.ReactElement {
    const sortedFormats = Object.entries(metrics.yieldByFormat)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5);

    return React.createElement(
      "div",
      { className: "yield-panel yield-by-format", style: panelStyle },
      React.createElement("h2", { style: panelTitleStyle }, "Yield by Format"),
      React.createElement(
        "table",
        { className: "yield-table", style: tableStyle },
        React.createElement(
          "thead",
          null,
          React.createElement(
            "tr",
            null,
            React.createElement("th", { style: thStyle }, "Format"),
            React.createElement("th", { style: { ...thStyle, textAlign: "right" } }, "Total Yield")
          )
        ),
        React.createElement(
          "tbody",
          null,
          ...sortedFormats.map(([format, yield_]) =>
            React.createElement(
              "tr",
              { key: format },
              React.createElement("td", { style: tdStyle }, format),
              React.createElement("td", { style: { ...tdStyle, textAlign: "right" } }, `$${yield_.toFixed(2)}`)
            )
          )
        )
      )
    );
  }

  private renderTimeSeriesChart(
    snapshots: YieldSnapshot[],
    metric: YieldDashState["selectedMetric"],
    timeRange: YieldDashState["selectedTimeRange"]
  ): React.ReactElement {
    const filteredSnapshots = this.filterSnapshotsByTimeRange(snapshots, timeRange);
    const chartData = this.prepareChartData(filteredSnapshots, metric);

    return React.createElement(
      "div",
      { className: "yield-chart-container", style: chartContainerStyle },
      React.createElement("h2", { style: panelTitleStyle }, `${this.getMetricLabel(metric)} Over Time`),
      React.createElement(
        "div",
        { className: "yield-chart", style: chartStyle },
        React.createElement(
          "svg",
          { width: "100%", height: "200", viewBox: "0 0 800 200" },
          this.renderChartPath(chartData)
        )
      )
    );
  }

  private renderBidFlowTable(bids: AggregatedBid[]): React.ReactElement {
    const topBids = bids.slice(0, 10);

    return React.createElement(
      "div",
      { className: "bid-flow-container", style: bidFlowContainerStyle },
      React.createElement("h2", { style: panelTitleStyle }, "Live Bid Flow"),
      React.createElement(
        "table",
        { className: "bid-flow-table", style: tableStyle },
        React.createElement(
          "thead",
          null,
          React.createElement(
            "tr",
            null,
            React.createElement("th", { style: thStyle }, "Bid ID"),
            React.createElement("th", { style: thStyle }, "DSP"),
            React.createElement("th", { style: thStyle }, "CPM"),
            React.createElement("th", { style: thStyle }, "Attention"),
            React.createElement("th", { style: thStyle }, "Effective CPM"),
            React.createElement("th", { style: thStyle }, "Rank")
          )
        ),
        React.createElement(
          "tbody",
          null,
          ...topBids.map((bid) =>
            React.createElement(
              "tr",
              { key: bid.bidId },
              React.createElement("td", { style: tdStyle }, bid.bidId.substring(0, 8)),
              React.createElement("td", { style: tdStyle }, bid.dspId),
              React.createElement("td", { style: tdStyle }, `$${bid.cpm.toFixed(2)}`),
              React.createElement("td", { style: tdStyle }, bid.attentionScore.toFixed(2)),
              React.createElement("td", { style: tdStyle }, `$${bid.effectiveCpm.toFixed(2)}`),
              React.createElement("td", { style: tdStyle }, `#${bid.rank}`)
            )
          )
        )
      )
    );
  }

  private renderMetricCard(label: string, value: string, unit: string): React.ReactElement {
    return React.createElement(
      "div",
      { className: `metric-card ${unit}`, style: metricCardStyle },
      React.createElement("div", { style: metricLabelStyle }, label),
      React.createElement("div", { style: metricValueStyle }, value)
    );
  }

  private renderFormatBar(format: string, count: number, percentage: number): React.ReactElement {
    return React.createElement(
      "div",
      { key: format, className: "format-bar", style: formatBarStyle },
      React.createElement("div", { style: formatLabelStyle }, `${format} (${count})`),
      React.createElement(
        "div",
        { style: formatBarContainerStyle },
        React.createElement("div", {
          style: {
            ...formatBarFillStyle,
            width: `${percentage}%`
          }
        })
      ),
      React.createElement("div", { style: formatPercentStyle }, `${percentage.toFixed(1)}%`)
    );
  }

  private renderChartPath(data: number[]): React.ReactElement {
    if (data.length === 0) {
      return React.createElement("text", { x: "400", y: "100", textAnchor: "middle", fill: "#666" }, "No data available");
    }

    const maxValue = Math.max(...data, 1);
    const stepX = 800 / (data.length - 1 || 1);
    const points = data.map((value, index) => {
      const x = index * stepX;
      const y = 200 - (value / maxValue) * 180;
      return `${x},${y}`;
    });

    const pathData = `M${points.join(" L")}`;

    return React.createElement("path", {
      d: pathData,
      fill: "none",
      stroke: "#00ff00",
      strokeWidth: "2"
    });
  }

  private renderTimeRangeSelector(): React.ReactElement {
    const ranges: Array<YieldDashState["selectedTimeRange"]> = ["1m", "5m", "15m", "1h"];

    return React.createElement(
      "div",
      { className: "time-range-selector", style: selectorStyle },
      ...ranges.map((range) =>
        React.createElement(
          "button",
          {
            key: range,
            onClick: () => this.setState({ selectedTimeRange: range }),
            style: {
              ...selectorButtonStyle,
              ...(this.state.selectedTimeRange === range ? selectorButtonActiveStyle : {})
            }
          },
          range.toUpperCase()
        )
      )
    );
  }

  private renderMetricSelector(): React.ReactElement {
    const metrics: Array<{ key: YieldDashState["selectedMetric"]; label: string }> = [
      { key: "yield", label: "Yield" },
      { key: "latency", label: "Latency" },
      { key: "volume", label: "Volume" },
      { key: "format", label: "Format" }
    ];

    return React.createElement(
      "div",
      { className: "metric-selector", style: selectorStyle },
      ...metrics.map((metric) =>
        React.createElement(
          "button",
          {
            key: metric.key,
            onClick: () => this.setState({ selectedMetric: metric.key }),
            style: {
              ...selectorButtonStyle,
              ...(this.state.selectedMetric === metric.key ? selectorButtonActiveStyle : {})
            }
          },
          metric.label
        )
      )
    );
  }

  private renderLiveFeedToggle(): React.ReactElement {
    return React.createElement(
      "button",
      {
        onClick: () => {
          const newLiveFeed = !this.state.liveFeed;
          this.setState({ liveFeed: newLiveFeed });
          if (newLiveFeed) {
            this.startLiveFeed();
          } else {
            this.stopLiveFeed();
          }
        },
        style: {
          ...selectorButtonStyle,
          ...(this.state.liveFeed ? { ...selectorButtonActiveStyle, backgroundColor: "#00ff00" } : {})
        }
      },
      this.state.liveFeed ? "● LIVE" : "○ PAUSED"
    );
  }

  private getLatencyStatus(latencyMs: number): { level: string; label: string; color: string } {
    if (latencyMs < 1) return { level: "excellent", label: "EXCELLENT", color: "#00ff00" };
    if (latencyMs < 5) return { level: "good", label: "GOOD", color: "#88ff00" };
    if (latencyMs < 10) return { level: "acceptable", label: "ACCEPTABLE", color: "#ffff00" };
    return { level: "degraded", label: "DEGRADED", color: "#ff0000" };
  }

  private getMetricLabel(metric: YieldDashState["selectedMetric"]): string {
    const labels: Record<YieldDashState["selectedMetric"], string> = {
      yield: "Total Yield",
      latency: "Execution Latency",
      volume: "Bid Volume",
      format: "Format Distribution"
    };
    return labels[metric];
  }

  private filterSnapshotsByTimeRange(snapshots: YieldSnapshot[], timeRange: YieldDashState["selectedTimeRange"]): YieldSnapshot[] {
    const now = Date.now();
    const ranges = { "1m": 60000, "5m": 300000, "15m": 900000, "1h": 3600000 };
    const cutoff = now - ranges[timeRange];
    return snapshots.filter((s) => s.timestamp >= cutoff);
  }

  private prepareChartData(snapshots: YieldSnapshot[], metric: YieldDashState["selectedMetric"]): number[] {
    return snapshots.map((s) => {
      switch (metric) {
        case "yield":
          return s.totalYield;
        case "latency":
          return s.avgExecutionLatencyMs;
        case "volume":
          return s.bidVolume;
        case "format":
          return s.yieldVelocity;
        default:
          return 0;
      }
    });
  }

  private startLiveFeed(): void {
    if (this.props.refreshIntervalMs) {
      this.refreshInterval = setInterval(() => {
        this.forceUpdate();
      }, this.props.refreshIntervalMs);
    }
  }

  private stopLiveFeed(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }
}

const containerStyle: React.CSSProperties = {
  backgroundColor: "#000",
  color: "#0f0",
  fontFamily: "monospace",
  padding: "20px",
  minHeight: "100vh"
};

const headerStyle: React.CSSProperties = {
  borderBottom: "2px solid #0f0",
  paddingBottom: "10px",
  marginBottom: "20px",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center"
};

const titleStyle: React.CSSProperties = {
  fontSize: "24px",
  margin: 0,
  color: "#0f0"
};

const controlsStyle: React.CSSProperties = {
  display: "flex",
  gap: "20px"
};

const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
  gap: "20px",
  marginBottom: "20px"
};

const panelStyle: React.CSSProperties = {
  border: "1px solid #0f0",
  padding: "15px",
  backgroundColor: "#001100"
};

const panelTitleStyle: React.CSSProperties = {
  fontSize: "16px",
  marginTop: 0,
  marginBottom: "15px",
  color: "#0f0",
  borderBottom: "1px solid #0f0",
  paddingBottom: "5px"
};

const metricGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "10px"
};

const metricCardStyle: React.CSSProperties = {
  padding: "10px",
  border: "1px solid #0f0",
  backgroundColor: "#000"
};

const metricLabelStyle: React.CSSProperties = {
  fontSize: "12px",
  color: "#0f0",
  marginBottom: "5px"
};

const metricValueStyle: React.CSSProperties = {
  fontSize: "20px",
  color: "#0f0",
  fontWeight: "bold"
};

const latencyDisplayStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: "10px"
};

const latencyValueStyle: React.CSSProperties = {
  fontSize: "32px",
  fontWeight: "bold"
};

const latencyStatusStyle: React.CSSProperties = {
  fontSize: "14px",
  fontWeight: "bold"
};

const latencyBarContainerStyle: React.CSSProperties = {
  width: "100%",
  height: "10px",
  backgroundColor: "#003300",
  border: "1px solid #0f0"
};

const latencyBarFillStyle: React.CSSProperties = {
  height: "100%",
  transition: "width 0.3s ease"
};

const formatListStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "10px"
};

const formatBarStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "120px 1fr 50px",
  gap: "10px",
  alignItems: "center"
};

const formatLabelStyle: React.CSSProperties = {
  fontSize: "12px"
};

const formatBarContainerStyle: React.CSSProperties = {
  width: "100%",
  height: "15px",
  backgroundColor: "#003300",
  border: "1px solid #0f0"
};

const formatBarFillStyle: React.CSSProperties = {
  height: "100%",
  backgroundColor: "#0f0",
  transition: "width 0.3s ease"
};

const formatPercentStyle: React.CSSProperties = {
  fontSize: "12px",
  textAlign: "right"
};

const chartsStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "20px"
};

const chartContainerStyle: React.CSSProperties = {
  border: "1px solid #0f0",
  padding: "15px",
  backgroundColor: "#001100"
};

const chartStyle: React.CSSProperties = {
  width: "100%"
};

const bidFlowContainerStyle: React.CSSProperties = {
  border: "1px solid #0f0",
  padding: "15px",
  backgroundColor: "#001100"
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse"
};

const thStyle: React.CSSProperties = {
  borderBottom: "1px solid #0f0",
  padding: "8px",
  textAlign: "left",
  fontSize: "12px",
  color: "#0f0"
};

const tdStyle: React.CSSProperties = {
  padding: "8px",
  fontSize: "11px",
  borderBottom: "1px solid #003300"
};

const selectorStyle: React.CSSProperties = {
  display: "flex",
  gap: "5px"
};

const selectorButtonStyle: React.CSSProperties = {
  backgroundColor: "#003300",
  color: "#0f0",
  border: "1px solid #0f0",
  padding: "5px 10px",
  cursor: "pointer",
  fontFamily: "monospace",
  fontSize: "12px"
};

const selectorButtonActiveStyle: React.CSSProperties = {
  backgroundColor: "#0f0",
  color: "#000"
};

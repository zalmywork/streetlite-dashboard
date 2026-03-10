const API = "https://script.google.com/macros/s/AKfycbzohKimSVO-FOCiWFkHlmwBv4DtQZiuqlD0ImdiLwMymEDNH6W_0MzT4U3GFC0ERVAN/exec";
const RESTOCK_THRESHOLD = 15;
const DAYS_IN_REPORT = 30;

function parseNum(v) {
  if (v === null || v === undefined || v === "") return 0;
  return parseFloat(String(v).replace(/\s/g, "").replace(",", ".")) || 0;
}

async function fetchSheet(sheetName) {
  const res = await fetch(API + "?sheet=" + encodeURIComponent(sheetName));
  if (!res.ok) throw new Error("HTTP " + res.status);
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json;
}

import React, { useState, useEffect } from "react";

export default function App() {
  var [sales, setSales] = useState([]);
  var [inventory, setInventory] = useState([]);
  var [loading, setLoading] = useState(true);
  var [loadingMsg, setLoadingMsg] = useState("Loading sales data...");
  var [error, setError] = useState("");
  var [tab, setTab] = useState("overview");
  var [search, setSearch] = useState("");
  var [sortCol, setSortCol] = useState("daysLeft");
  var [sortDir, setSortDir] = useState("asc");
  var [aiQ, setAiQ] = useState("");
  var [aiA, setAiA] = useState("");
  var [aiLoading, setAiLoading] = useState(false);
  var [lastUpdated, setLastUpdated] = useState(null);

  function load() {
    setLoading(true);
    setError("");
    setLoadingMsg("Loading sales data...");
    fetchSheet("Sales").then(function(s) {
      setSales(Array.isArray(s) ? s : []);
      setLoadingMsg("Loading inventory data...");
      return fetchSheet("Inventory");
    }).then(function(i) {
      setInventory(Array.isArray(i) ? i : []);
      setLastUpdated(new Date());
      setLoading(false);
    }).catch(function(e) {
      setError(e.message);
      setLoading(false);
    });
  }

  useEffect(function() { load(); }, []);

  var productRows = sales.filter(function(r) { return r["ASIN"] && String(r["ASIN"]).trim() !== ""; });
  var brandRows = sales.filter(function(r) { return !r["ASIN"] || String(r["ASIN"]).trim() === ""; });

  var totalRevenue = productRows.reduce(function(s,r) { return s + parseNum(r["Sales"]); }, 0);
  var totalUnits = productRows.reduce(function(s,r) { return s + parseNum(r["Units"]); }, 0);
  var totalNetProfit = productRows.reduce(function(s,r) { return s + parseNum(r["Net profit"]); }, 0);
  var totalRefunds = productRows.reduce(function(s,r) { return s + parseNum(r["Refunds"]); }, 0);
  var totalAds = productRows.reduce(function(s,r) { return s + parseNum(r["Ads"]); }, 0);
  var avgMargin = productRows.length > 0 ? productRows.reduce(function(s,r) { return s + parseNum(r["Margin"]); }, 0) / productRows.length : 0;

  var brandRevMap = {};
  brandRows.forEach(function(r) {
    var b = String(r["Brand / Product"] || "").trim();
    if (b) brandRevMap[b] = (brandRevMap[b] || 0) + parseNum(r["Sales"]);
  });
  var topBrands = Object.entries(brandRevMap).sort(function(a,b) { return b[1]-a[1]; }).slice(0,10);
  var maxBrandRev = topBrands[0] ? topBrands[0][1] : 1;

  var restockData = inventory.filter(function(r) {
    return r["ProductName"] && r["ProductName"] !== "ProductName" && r["ProductName"] !== "";
  }).map(function(r) {
    var asin = String(r["ASIN"] || "").trim();
    var name = String(r["ProductName"] || "").trim();
    var brand = String(r["Brand"] || "").trim();
    var totalStock = parseNum(r["Total"]);
    var fbaStock = parseNum(r["FBA_Warehouse"]);
    var bartlett = parseNum(r["Bartlett_Distribution"]);
    var florida = parseNum(r["Florida_Distribution_Center"]);
    var salesRow = productRows.find(function(s) { return String(s["ASIN"]).trim() === asin; });
    var unitsSold = salesRow ? parseNum(salesRow["Units"]) : 0;
    var dailyVelocity = unitsSold / DAYS_IN_REPORT;
    var daysLeft = dailyVelocity > 0 ? Math.round(totalStock / dailyVelocity) : 999;
    var suggestedReorder = dailyVelocity > 0 ? Math.round(dailyVelocity * 45) : 0;
    var status = daysLeft <= 7 ? "red" : daysLeft <= RESTOCK_THRESHOLD ? "yellow" : "green";
    return { asin: asin, name: name, brand: brand, totalStock: totalStock, fbaStock: fbaStock, bartlett: bartlett, florida: florida, unitsSold: unitsSold, dailyVelocity: dailyVelocity, daysLeft: daysLeft, suggestedReorder: suggestedReorder, status: status };
  });

  var critical = restockData.filter(function(r) { return r.status === "red"; });
  var warning = restockData.filter(function(r) { return r.status === "yellow"; });
  var healthy = restockData.filter(function(r) { return r.status === "green"; });

  var filtered = restockData.filter(function(r) {
    return !search || r.name.toLowerCase().includes(search.toLowerCase()) || r.asin.toLowerCase().includes(search.toLowerCase()) || r.brand.toLowerCase().includes(search.toLowerCase());
  }).sort(function(a,b) {
    var av = a[sortCol], bv = b[sortCol];
    if (typeof av === "number") return sortDir === "asc" ? av-bv : bv-av;
    return sortDir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
  });

  function toggleSort(col) {
    if (sortCol === col) setSortDir(function(d) { return d === "asc" ? "desc" : "asc"; });
    else { setSortCol(col); setSortDir("asc"); }
  }

  function askAI() {
    if (!aiQ.trim()) return;
    setAiLoading(true); setAiA("");
    var ctx = "You are an Amazon seller assistant for Streetlite Company.\n\nSALES (last " + DAYS_IN_REPORT + " days):\nRevenue: $" + totalRevenue.toFixed(2) + " | Units: " + totalUnits + " | Net Profit: $" + totalNetProfit.toFixed(2) + " | Margin: " + avgMargin.toFixed(1) + "% | Refunds: " + totalRefunds + "\n\nTOP BRANDS:\n" + topBrands.map(function(b) { return b[0] + ": $" + b[1].toFixed(2); }).join("\n") + "\n\nCRITICAL STOCK:\n" + critical.slice(0,15).map(function(r) { return r.name + " | " + r.asin + " | Stock: " + r.totalStock + " | Days: " + r.daysLeft + " | Reorder: " + r.suggestedReorder; }).join("\n") + "\n\nWARNING STOCK:\n" + warning.slice(0,15).map(function(r) { return r.name + " | " + r.asin + " | Stock: " + r.totalStock + " | Days: " + r.daysLeft; }).join("\n");
    fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, system: ctx, messages: [{ role: "user", content: aiQ }] })
    }).then(function(res) { return res.json(); }).then(function(data) {
      setAiA(data.content && data.content[0] ? data.content[0].text : "No response.");
      setAiLoading(false);
    }).catch(function(e) { setAiA("Error: " + e.message); setAiLoading(false); });
  }

  var fmt = function(n) { return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var sc = function(s) { return s === "red" ? "#ef4444" : s === "yellow" ? "#f59e0b" : "#22c55e"; };
  var sbg = function(s) { return s === "red" ? "#fef2f2" : s === "yellow" ? "#fffbeb" : "white"; };
  var sl = function(s) { return s === "red" ? "🔴 Critical" : s === "yellow" ? "🟡 Warning" : "🟢 Healthy"; };

  if (loading) return React.createElement("div", { style: { fontFamily: "Inter,sans-serif", minHeight: "100vh", background: "#f8fafc", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 } },
    React.createElement("div", { style: { fontSize: 40 } }, "📦"),
    React.createElement("div", { style: { color: "#1e293b", fontSize: 16, fontWeight: 600 } }, "Streetlite Dashboard"),
    React.createElement("div", { style: { color: "#64748b", fontSize: 14 } }, loadingMsg)
  );

  if (error) return React.createElement("div", { style: { fontFamily: "Inter,sans-serif", minHeight: "100vh", background: "#f8fafc", display: "flex", alignItems: "center", justifyContent: "center" } },
    React.createElement("div", { style: { background: "white", borderRadius: 16, padding: 40, maxWidth: 500, textAlign: "center" } },
      React.createElement("div", { style: { fontSize: 36, marginBottom: 12 } }, "⚠️"),
      React.createElement("h2", { style: { color: "#dc2626" } }, "Could not load data"),
      React.createElement("p", { style: { color: "#64748b", fontSize: 13 } }, error),
      React.createElement("button", { onClick: load, style: { padding: "10px 28px", background: "#2563eb", color: "white", border: "none", borderRadius: 8, fontWeight: 600, cursor: "pointer" } }, "Try Again")
    )
  );

  return React.createElement("div", { style: { fontFamily: "Inter,sans-serif", minHeight: "100vh", background: "#f8fafc" } },
    React.createElement("div", { style: { background: "white", borderBottom: "1px solid #e2e8f0", padding: "0 28px" } },
      React.createElement("div", { style: { maxWidth: 1400, margin: "0 auto", display: "flex", alignItems: "center", height: 58, gap: 24 } },
        React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } },
          React.createElement("span", { style: { fontSize: 20 } }, "📦"),
          React.createElement("span", { style: { fontWeight: 700, fontSize: 17, color: "#1e293b" } }, "Streetlite Dashboard"),
          React.createElement("span", { style: { fontSize: 10, color: "#22c55e", background: "#f0fdf4", padding: "2px 7px", borderRadius: 10, fontWeight: 600 } }, "● LIVE")
        ),
        React.createElement("div", { style: { display: "flex", gap: 2, flex: 1, justifyContent: "center" } },
          [
            { id: "overview", label: "Overview" },
            { id: "restock", label: "Restock " + (critical.length > 0 ? "🔴" + critical.length : warning.length > 0 ? "🟡" + warning.length : "") },
            { id: "brands", label: "Brands" },
            { id: "chat", label: "AI Chat" }
          ].map(function(t) {
            return React.createElement("button", { key: t.id, onClick: function() { setTab(t.id); }, style: { padding: "6px 18px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 500, background: tab === t.id ? "#2563eb" : "transparent", color: tab === t.id ? "white" : "#64748b" } }, t.label);
          })
        ),
        React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10 } },
          lastUpdated && React.createElement("span", { style: { fontSize: 11, color: "#94a3b8" } }, "Updated " + lastUpdated.toLocaleTimeString()),
          React.createElement("button", { onClick: load, style: { fontSize: 12, color: "#64748b", background: "#f1f5f9", border: "none", borderRadius: 6, padding: "6px 12px", cursor: "pointer" } }, "↻ Refresh")
        )
      )
    ),
    React.createElement("div", { style: { maxWidth: 1400, margin: "0 auto", padding: "24px 28px" } },
      tab === "overview" && React.createElement(React.Fragment, null,
        React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 14, marginBottom: 20 } },
          [
            { label: "Total Revenue", value: fmt(totalRevenue), icon: "💰", color: "#1e293b" },
            { label: "Units Sold", value: totalUnits.toLocaleString(), icon: "📦", color: "#1e293b" },
            { label: "Net Profit", value: fmt(totalNetProfit), icon: "📈", color: totalNetProfit >= 0 ? "#16a34a" : "#dc2626" },
            { label: "Avg Margin", value: avgMargin.toFixed(1) + "%", icon: "📊", color: avgMargin >= 0 ? "#16a34a" : "#dc2626" },
            { label: "Total Refunds", value: totalRefunds.toLocaleString(), icon: "↩️", color: "#1e293b" }
          ].map(function(s,i) {
            return React.createElement("div", { key: i, style: { background: "white", borderRadius: 12, padding: "18px 20px", boxShadow: "0 1px 4px rgba(0,0,0,0.06)" } },
              React.createElement("div", { style: { fontSize: 18, marginBottom: 6 } }, s.icon),
              React.createElement("div", { style: { fontSize: 21, fontWeight: 700, color: s.color } }, s.value),
              React.createElement("div", { style: { fontSize: 11, color: "#94a3b8", marginTop: 3 } }, s.label)
            );
          })
        ),
        critical.length > 0 && React.createElement("div", { onClick: function() { setTab("restock"); }, style: { background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "11px 18px", marginBottom: 10, display: "flex", alignItems: "center", gap: 10, cursor: "pointer" } },
          React.createElement("span", null, "🔴"),
          React.createElement("span", { style: { fontWeight: 600, color: "#dc2626", fontSize: 13 } }, critical.length + " products critically low on stock"),
          React.createElement("span", { style: { marginLeft: "auto", fontSize: 12, color: "#dc2626" } }, "View →")
        ),
        warning.length > 0 && React.createElement("div", { onClick: function() { setTab("restock"); }, style: { background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 10, padding: "11px 18px", marginBottom: 20, display: "flex", alignItems: "center", gap: 10, cursor: "pointer" } },
          React.createElement("span", null, "🟡"),
          React.createElement("span", { style: { fontWeight: 600, color: "#d97706", fontSize: 13 } }, warning.length + " products approaching restock threshold"),
          React.createElement("span", { style: { marginLeft: "auto", fontSize: 12, color: "#d97706" } }, "View →")
        ),
        React.createElement("div", { style: { background: "white", borderRadius: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.06)", overflow: "hidden" } },
          React.createElement("div", { style: { padding: "14px 20px", borderBottom: "1px solid #f1f5f9" } },
            React.createElement("h2", { style: { margin: 0, fontSize: 15, fontWeight: 600, color: "#1e293b" } }, "Top Products by Revenue")
          ),
          React.createElement("div", { style: { overflowX: "auto" } },
            React.createElement("table", { style: { width: "100%", borderCollapse: "collapse", fontSize: 12 } },
              React.createElement("thead", null,
                React.createElement("tr", { style: { background: "#f8fafc" } },
                  ["Brand","ASIN","SKU","Units","Revenue","Net Profit","Margin","Refunds","Ad Spend"].map(function(h) {
                    return React.createElement("th", { key: h, style: { padding: "9px 14px", textAlign: "left", fontWeight: 600, color: "#64748b", whiteSpace: "nowrap" } }, h);
                  })
                )
              ),
              React.createElement("tbody", null,
                productRows.slice().sort(function(a,b) { return parseNum(b["Sales"])-parseNum(a["Sales"]); }).slice(0,30).map(function(r,i) {
                  return React.createElement("tr", { key: i, style: { borderTop: "1px solid #f1f5f9" } },
                    React.createElement("td", { style: { padding: "9px 14px", fontWeight: 500 } }, r["Brand / Product"]),
                    React.createElement("td", { style: { padding: "9px 14px", color: "#2563eb", fontFamily: "monospace", fontSize: 11 } }, r["ASIN"]),
                    React.createElement("td", { style: { padding: "9px 14px", color: "#64748b", fontSize: 11 } }, r["SKU"]),
                    React.createElement("td", { style: { padding: "9px 14px" } }, parseNum(r["Units"])),
                    React.createElement("td", { style: { padding: "9px 14px", fontWeight: 600 } }, fmt(parseNum(r["Sales"]))),
                    React.createElement("td", { style: { padding: "9px 14px", fontWeight: 600, color: parseNum(r["Net profit"]) >= 0 ? "#16a34a" : "#dc2626" } }, fmt(parseNum(r["Net profit"]))),
                    React.createElement("td", { style: { padding: "9px 14px" } }, parseNum(r["Margin"]).toFixed(1) + "%"),
                    React.createElement("td", { style: { padding: "9px 14px" } }, parseNum(r["Refunds"])),
                    React.createElement("td", { style: { padding: "9px 14px", color: "#dc2626" } }, fmt(Math.abs(parseNum(r["Ads"]))))
                  );
                })
              )
            )
          )
        )
      ),

      tab === "restock" && React.createElement(React.Fragment, null,
        React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, marginBottom: 20 } },
          [
            { label: "Critical (≤7 days)", value: critical.length, color: "#dc2626", bg: "#fef2f2" },
            { label: "Warning (8-15 days)", value: warning.length, color: "#d97706", bg: "#fffbeb" },
            { label: "Healthy (>15 days)", value: healthy.length, color: "#16a34a", bg: "#f0fdf4" }
          ].map(function(s,i) {
            return React.createElement("div", { key: i, style: { background: s.bg, borderRadius: 12, padding: "18px 22px" } },
              React.createElement("div", { style: { fontSize: 26, fontWeight: 700, color: s.color } }, s.value),
              React.createElement("div", { style: { fontSize: 12, color: s.color, marginTop: 3 } }, s.label)
            );
          })
        ),
        React.createElement("div", { style: { background: "white", borderRadius: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.06)", overflow: "hidden" } },
          React.createElement("div", { style: { padding: "14px 20px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center" } },
            React.createElement("h2", { style: { margin: 0, fontSize: 15, fontWeight: 600, color: "#1e293b" } }, "Restock Alerts"),
            React.createElement("input", { value: search, onChange: function(e) { setSearch(e.target.value); }, placeholder: "Search product, ASIN, brand...", style: { marginLeft: "auto", padding: "7px 12px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12, width: 260 } })
          ),
          React.createElement("div", { style: { overflowX: "auto" } },
            React.createElement("table", { style: { width: "100%", borderCollapse: "collapse", fontSize: 12 } },
              React.createElement("thead", null,
                React.createElement("tr", { style: { background: "#f8fafc" } },
                  [["status","Status"],["name","Product"],["asin","ASIN"],["brand","Brand"],["totalStock","Total"],["fbaStock","FBA"],["bartlett","Bartlett"],["florida","Florida"],["unitsSold","Units/30d"],["dailyVelocity","Daily"],["daysLeft","Days Left"],["suggestedReorder","Reorder Qty"]].map(function(col) {
                    return React.createElement("th", { key: col[0], onClick: function() { toggleSort(col[0]); }, style: { padding: "9px 14px", textAlign: "left", fontWeight: 600, color: "#64748b", whiteSpace: "nowrap", cursor: "pointer" } }, col[1] + (sortCol === col[0] ? (sortDir === "asc" ? " ↑" : " ↓") : ""));
                  })
                )
              ),
              React.createElement("tbody", null,
                filtered.map(function(r,i) {
                  return React.createElement("tr", { key: i, style: { borderTop: "1px solid #f1f5f9", background: sbg(r.status) } },
                    React.createElement("td", { style: { padding: "9px 14px" } }, React.createElement("span", { style: { fontWeight: 600, color: sc(r.status), fontSize: 11 } }, sl(r.status))),
                    React.createElement("td", { style: { padding: "9px 14px", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, r.name),
                    React.createElement("td", { style: { padding: "9px 14px", color: "#2563eb", fontFamily: "monospace", fontSize: 11 } }, r.asin),
                    React.createElement("td", { style: { padding: "9px 14px" } }, r.brand),
                    React.createElement("td", { style: { padding: "9px 14px", fontWeight: 600 } }, r.totalStock),
                    React.createElement("td", { style: { padding: "9px 14px" } }, r.fbaStock),
                    React.createElement("td", { style: { padding: "9px 14px" } }, r.bartlett),
                    React.createElement("td", { style: { padding: "9px 14px" } }, r.florida),
                    React.createElement("td", { style: { padding: "9px 14px" } }, r.unitsSold),
                    React.createElement("td", { style: { padding: "9px 14px" } }, r.dailyVelocity.toFixed(1)),
                    React.createElement("td", { style: { padding: "9px 14px", fontWeight: 700, color: sc(r.status) } }, r.daysLeft === 999 ? "∞" : r.daysLeft),
                    React.createElement("td", { style: { padding: "9px 14px", color: "#2563eb", fontWeight: 600 } }, r.suggestedReorder > 0 ? r.suggestedReorder : "-")
                  );
                })
              )
            )
          )
        )
      ),

      tab === "brands" && React.createElement("div", { style: { background: "white", borderRadius: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.06)", padding: 24 } },
        React.createElement("h2", { style: { margin: "0 0 24px", fontSize: 15, fontWeight: 600, color: "#1e293b" } }, "Revenue by Brand"),
        topBrands.map(function(b, i) {
          return React.createElement("div", { key: i, style: { marginBottom: 18 } },
            React.createElement("div", { style: { display: "flex", justifyContent: "space-between", marginBottom: 5 } },
              React.createElement("span", { style: { fontWeight: 500, color: "#1e293b", fontSize: 14 } }, b[0]),
              React.createElement("span", { style: { fontWeight: 700, color: "#1e293b", fontSize: 14 } }, fmt(b[1]))
            ),
            React.createElement("div", { style: { height: 8, background: "#f1f5f9", borderRadius: 4, overflow: "hidden" } },
              React.createElement("div", { style: { height: "100%", width: (b[1]/maxBrandRev*100) + "%", background: "#2563eb", borderRadius: 4 } })
            )
          );
        })
      ),

      tab === "chat" && React.createElement("div", { style: { maxWidth: 700, margin: "0 auto" } },
        React.createElement("div", { style: { background: "white", borderRadius: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.06)", padding: 24, marginBottom: 14 } },
          React.createElement("h2", { style: { margin: "0 0 4px", fontSize: 15, fontWeight: 600, color: "#1e293b" } }, "AI Assistant"),
          React.createElement("p", { style: { margin: "0 0 18px", fontSize: 12, color: "#94a3b8" } }, "Ask anything about your live sales and inventory data."),
          React.createElement("div", { style: { display: "flex", gap: 8, marginBottom: 14 } },
            React.createElement("input", { value: aiQ, onChange: function(e) { setAiQ(e.target.value); }, onKeyDown: function(e) { if(e.key==="Enter") askAI(); }, placeholder: "e.g. What should I reorder this week?", style: { flex: 1, padding: "10px 14px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 13 } }),
            React.createElement("button", { onClick: askAI, disabled: aiLoading, style: { padding: "10px 20px", background: "#2563eb", color: "white", border: "none", borderRadius: 8, fontWeight: 600, cursor: "pointer" } }, aiLoading ? "..." : "Ask")
          ),
          aiA && React.createElement("div", { style: { background: "#f8fafc", borderRadius: 8, padding: 16, fontSize: 13, color: "#1e293b", lineHeight: 1.7, whiteSpace: "pre-wrap" } }, aiA)
        ),
        React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 8 } },
          ["What should I reorder this week?","Which brand is most profitable?","Which products have negative margin?","Which products have the highest refund rate?"].map(function(q,i) {
            return React.createElement("button", { key: i, onClick: function() { setAiQ(q); }, style: { padding: "7px 14px", background: "white", border: "1px solid #e2e8f0", borderRadius: 20, fontSize: 12, color: "#64748b", cursor: "pointer" } }, q);
          })
        )
      )
    )
  );
}

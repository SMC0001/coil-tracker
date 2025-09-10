/* =============================== APP WRAPPER =============================== */
import axios from "axios";
import { useState, useEffect, useMemo, useRef } from "react";
import Login from "./Login.jsx";                // ✅ your Login.jsx file
import { useAuth } from "./AuthContext.jsx";    // ✅ direct file, no "auth/" folder
import Protected from "./srcauthProtected.jsx"; // ✅ match actual filename
import StickyTable from "./components/StickyTable";


// 🔹 Axios Interceptor: Attach token to every request automatically
axios.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});


const API = import.meta.env.VITE_API_URL || "/api";
const GRADES = ["304", "430", "204CU", "DD", "SDM"];
const OPERATORS = ["Duta", "Jay Prakash", "Majesh", "Ram Patel", "Sunil"];

/* ----------------------------- shared UI bits ----------------------------- */
function Section({ title, right, children }) {
  return (
    <section className="bg-white rounded-xl shadow p-3 w-full">
      <div className="flex items-center justify-between border-b pb-2 mb-3">
        <h2 className="font-semibold">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

function Input({ label, className = "", ...props }) {
  return (
    <label className="text-sm w-full">
      {label && <div className="text-slate-600 mb-1">{label}</div>}
      <input
        {...props}
        className={`w-full border rounded-lg px-3 py-2 ${className}`}
      />
    </label>
  );
}
function NumberInput(props) {
  return <Input {...props} type="number" step="any" inputMode="decimal" />;
}
const fmt = (v) =>
  (v ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const fmtDate = (iso) => (iso ? iso.slice(0, 10) : "—");


function ExportSheetButton({ tab }) {
  // FRONTEND → BACKEND export name map
  const map = {
    // dashboards
    all: "all",

    // orders
    orders: "orders",
    dispatched: "dispatched",

    // coils
    coils: "coils",      // if you really want “coil purchases”, change to "coils"
    coilstock: "coil_stock",
    coilsales: "coil_sales",

    // circles
    circlestock: "circle_stock",
    circlesales: "circle_sales",
    circle_runs: "circle_runs",   // <-- add if backend supports it

    // patta
    patta_runs: "patta_runs",     // <-- add if backend supports it

    // PL
    plstock: "pl_stock",
    plsales: "pl_sales",

    // scrap / yield
    scrap: "scrap_sales",
    yield: "yield",
  };

  const key = map[tab] || tab;
  const url = `${API}/export/${key}?_=${Date.now()}`; // cache-bust

  return (
    <button
      onClick={() => window.open(url, "_blank")}
      className="bg-emerald-600 text-white rounded-lg px-3 py-2"
      type="button"
    >
      Export Excel
    </button>
  );
}

function NumCell({ val, on, w }) {
  return (
    <input
      type="number"
      className="border rounded px-2 py-1 text-right"
      style={{ width: w }}
      value={val}
      onChange={(e) => on(e.target.value)}
    />
  );
}

/* ================================ ORDERS ================================== */
function OrdersTab() {
  const [orders, setOrders] = useState([]);
  const [view, setView] = useState("open"); // 'open' | 'cancelled'
  const [cancelRemark, setCancelRemark] = useState("");
  const [showCancelPrompt, setShowCancelPrompt] = useState(null);

  // Same pattern as Coils: keep only importResult and reuse handler style
  const [importResult, setImportResult] = useState(null);

  // Only show non-dispatched orders in "open" view
  const openOrders = useMemo(
    () =>
      (orders || []).filter(
        (o) =>
          (o.status || "").toLowerCase() !== "fulfilled" &&
          (o.status || "").toLowerCase() !== "dispatched" &&
          !o.cancelled_at
      ),
    [orders]
  );

  // Show cancelled orders in "cancelled" view
  const cancelledOrders = useMemo(
    () => (orders || []).filter((o) => !!o.cancelled_at),
    [orders]
  );

  const rows = view === "cancelled" ? cancelledOrders : openOrders;

  const [q, setQ] = useState("");
  const [gradeFilter, setGradeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState({});

  const [form, setForm] = useState({
    order_date: "",
    order_by: "",
    company: "",
    grade: "",
    thickness: "",
    op_size_mm: "",
    ordered_qty: "",
    ordered_weight_kg: "",
  });

  const toNum = (v) => (v === "" || v == null ? null : Number(v));

  const load = async () => {
    try {
      const res = await axios.get(`${API}/orders`, {
        params: {
          q,
          grade: gradeFilter || undefined,
          status: statusFilter || undefined,
        },
      });
      setOrders(res.data || []);
    } catch {
      /* ignore */
    }
  };
  useEffect(() => {
    load();
  }, [q, gradeFilter, statusFilter]);

  // refresh when sales change things elsewhere
  useEffect(() => {
    const onRefresh = () => load();
    window.addEventListener("orders:refresh", onRefresh);
    return () => window.removeEventListener("orders:refresh", onRefresh);
  }, []);

  const createOrder = async (e) => {
    e.preventDefault();
    const payload = {
      order_date: form.order_date || null,
      order_by: form.order_by || null,
      company: form.company || null,
      grade: form.grade || null,
      thickness_mm: toNum(form.thickness),
      op_size_mm: toNum(form.op_size_mm),
      ordered_qty_pcs: toNum(form.ordered_qty),
      ordered_weight_kg: toNum(form.ordered_weight_kg),
      // legacy mirrors (safe)
      thickness: toNum(form.thickness),
      width: toNum(form.op_size_mm),
      weight: toNum(form.ordered_weight_kg),
    };
    try {
      await axios.post(`${API}/orders`, payload);
      setForm({
        order_date: "",
        order_by: "",
        company: "",
        grade: "",
        thickness: "",
        op_size_mm: "",
        ordered_qty: "",
        ordered_weight_kg: "",
      });
      load();
    } catch {
      alert("Failed to add order");
    }
  };

  const startEdit = (o) => {
    setEditingId(o.order_no);
    setDraft({
      order_date: fmtDate(o.order_date) || "",
      order_by: o.order_by || "",
      company: o.company || "",
      grade: o.grade || "",
      thickness: o.thickness_mm ?? "",
      op_size_mm: o.op_size_mm ?? "",
      ordered_qty: o.ordered_qty_pcs ?? "",
      ordered_weight_kg: o.ordered_weight_kg ?? "",
    });
  };
  const cancelEdit = () => {
    setEditingId(null);
    setDraft({});
  };

  const saveEdit = async (id) => {
    const payload = {
      order_date: draft.order_date || null,
      order_by: draft.order_by || null,
      company: draft.company || null,
      grade: draft.grade || null,
      thickness_mm: toNum(draft.thickness),
      op_size_mm: toNum(draft.op_size_mm),
      ordered_qty_pcs: toNum(draft.ordered_qty),
      ordered_weight_kg: toNum(draft.ordered_weight_kg),
      thickness: toNum(draft.thickness),
      width: toNum(draft.op_size_mm),
      weight: toNum(draft.ordered_weight_kg),
    };
    try {
      await axios.patch(`${API}/orders/${id}`, payload);
      await load();
      cancelEdit();
    } catch {
      alert("Save failed");
    }
  };

  const deleteOrder = async (id) => {
    if (!confirm("Delete this order?")) return;
    try {
      await axios.delete(`${API}/orders/${id}`);
      load();
    } catch {
      alert("Delete failed");
    }
  };

  // Cancel/Uncancel
  const cancelOrder = (id) => {
    setCancelRemark("");
    setShowCancelPrompt(id); // open popup
  };

  const confirmCancelOrder = async () => {
    if (!cancelRemark.trim()) {
      alert("Please enter a cancellation remark");
      return;
    }
    try {
      await axios.patch(`${API}/orders/${showCancelPrompt}/cancel`, {
        remarks: cancelRemark,
      });
      setShowCancelPrompt(null);
      await load();
    } catch (e) {
      alert(e?.response?.data?.error || "Failed to cancel order");
    }
  };

  const uncancelOrder = async (id) => {
    try {
      await axios.patch(`${API}/orders/${id}/uncancel`);
      await load();
    } catch (e) {
      alert(e?.response?.data?.error || "Failed to un-cancel order");
    }
  };

  // === Import handler (EXACT same as Coils, but endpoint /orders/import) ===
  const handleImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    try {
      const token = localStorage.getItem("token");
      const res = await axios.post(`${API}/orders/import`, formData, {
        headers: {
          Authorization: token ? `Bearer ${token}` : "",
          "Content-Type": "multipart/form-data",
        },
      });
      setImportResult({ type: "success", data: res.data });
      await load();
    } catch (err) {
      console.error("❌ Import failed", err);
      setImportResult({
        type: "error",
        error: err.response?.data?.error || "Import failed",
      });
    } finally {
      // allow re-selecting the same file
      e.target.value = "";
    }
  };

  // Table Head helper
  const Head = ({ children, right, w, className = "" }) => (
    <th
      className={`whitespace-nowrap ${right ? "text-right" : "text-left"} ${className}`}
      style={{ width: w }}
    >
      {children}
    </th>
  );

  const renderStatus = (status, cancelled_at) => {
    if (cancelled_at) {
      return (
        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-rose-100 text-rose-700 border border-rose-200">
          Cancelled
        </span>
      );
    }

    const v = (status || "").toLowerCase();
    let color = "bg-slate-200 text-slate-700 border border-slate-300";
    let label = "Pending";
    if (v === "fulfilled" || v === "dispatched") {
      color = "bg-emerald-100 text-emerald-700 border-emerald-200";
      label = "Dispatched";
    } else if (v.startsWith("partial")) {
      color = "bg-amber-100 text-amber-700 border-amber-200";
      label = "Partially Dispatched";
    }
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${color}`}>
        {label}
      </span>
    );
  };

  return (
    <div className="space-y-4">
      <Section
        title="New Order"
        right={
          <div className="flex items-center gap-2">
            {/* View toggle */}
            <div className="bg-slate-100 rounded-lg p-1 flex">
              <button
                type="button"
                onClick={() => setView("open")}
                className={`px-3 py-1 rounded ${view === "open" ? "bg-white shadow border" : ""}`}
              >
                Open
              </button>
              <button
                type="button"
                onClick={() => setView("cancelled")}
                className={`px-3 py-1 rounded ${view === "cancelled" ? "bg-white shadow border" : ""}`}
              >
                Cancelled
              </button>
            </div>

            {/* Search / filters */}
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search company / grade / order"
              className="border rounded-lg px-3 py-2 w-64"
            />

            <label className="text-sm">
              <div className="text-slate-600 mb-1">Grade</div>
              <select
                value={gradeFilter}
                onChange={(e) => setGradeFilter(e.target.value)}
                className="border rounded-lg px-3 py-2"
              >
                <option value="">All Grades</option>
                {GRADES.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              <div className="text-slate-600 mb-1">Status</div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="border rounded-lg px-3 py-2"
              >
                <option value="">All</option>
                <option value="Pending">Pending</option>
                <option value="Partial">Partial</option>
                <option value="Fulfilled">Dispatched</option>
              </select>
            </label>

            <ExportSheetButton tab="orders" />

            {/* EXACT same Import Excel control as Coils */}
            <label className="bg-emerald-600 text-white px-3 py-2 rounded-lg cursor-pointer">
              Import Excel
              <input
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={handleImport}
              />
            </label>
          </div>
        }
      >
        {/* Import result message (same pattern as Coils) */}
        {importResult && (
          <div
            className={`p-2 mb-3 rounded ${
              importResult.type === "success"
                ? "bg-green-100 text-green-700"
                : "bg-red-100 text-red-700"
            }`}
          >
            {importResult.type === "success" ? (
              <>✅ Imported: {importResult.data.inserted}, Skipped: {importResult.data.skipped}</>
            ) : (
              <>❌ {importResult.error}</>
            )}
          </div>
        )}

        {/* Create form */}
        <form
          onSubmit={createOrder}
          className="grid grid-cols-2 md:grid-cols-8 gap-3 mb-3"
        >
          <Input label="Order Date" type="date" value={form.order_date}
            onChange={(e) => setForm({ ...form, order_date: e.target.value })}
          />
          <Input label="Order By" value={form.order_by}
            onChange={(e) => setForm({ ...form, order_by: e.target.value })}
          />
          <Input label="Company" value={form.company}
            onChange={(e) => setForm({ ...form, company: e.target.value })}
          />
          <label className="text-sm">
            <div className="text-slate-600 mb-1">Grade</div>
            <select
              value={form.grade}
              onChange={(e) => setForm({ ...form, grade: e.target.value })}
              className="border rounded-lg px-3 py-2 w-full"
            >
              <option value="">—</option>
              {GRADES.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </label>
          <NumberInput label="Thickness (mm)" value={form.thickness}
            onChange={(e) => setForm({ ...form, thickness: e.target.value })}
          />
          <NumberInput label="Op. Size (mm)" value={form.op_size_mm}
            onChange={(e) => setForm({ ...form, op_size_mm: e.target.value })}
          />
          <NumberInput label="Ordered Pcs" value={form.ordered_qty}
            onChange={(e) => setForm({ ...form, ordered_qty: e.target.value })}
          />
          <NumberInput label="Ordered Weight (kg)" value={form.ordered_weight_kg}
            onChange={(e) => setForm({ ...form, ordered_weight_kg: e.target.value })}
          />
          <div>
            <button className="bg-sky-600 text-white rounded-lg px-3 py-2 w-full h-full">
              Save
            </button>
          </div>
        </form>

        {/* Orders table */}
        <StickyTable
          headers={[
            { label: "Order No", className: "w-20" },
            { label: "Order Date", className: "w-28" },
            { label: "Order By", className: "w-28" },
            { label: "Company", className: "w-36" },
            { label: "Grade", className: "w-24" },
            { label: "Thickness", className: "w-24" },
            { label: "Op. Size (mm)", className: "w-28" },
            { label: "Ordered Pcs", className: "text-right w-28" },
            { label: "Ordered (kg)", className: "text-right w-36" },
            { label: "Fulfilled (kg)", className: "text-right w-36" },
            { label: "Remaining (kg)", className: "text-right w-40" },
            { label: "Cancelled On", className: "pl-3 w-36" },
            { label: "Remarks", className: "pl-3 w-44" },
            { label: "Status", className: "pl-3 w-36 border-l border-slate-200" },
            { label: "Actions", className: "pl-4 w-40" },
          ]}
        >
          {rows.map((o) => {
            const isEdit = editingId === o.order_no && view !== "cancelled";
            return (
              <tr key={o.order_no} className="border-t">
  <td>{o.order_no}</td>

  {/* Order Date */}
  <td>
    {isEdit ? (
      <input
        type="date"
        className="border rounded px-2 py-1"
        value={draft.order_date}
        onChange={(e) => setDraft({ ...draft, order_date: e.target.value })}
      />
    ) : (
      o.order_date || "—"
    )}
  </td>

  {/* Order By */}
  <td>
    {isEdit ? (
      <input
        className="border rounded px-2 py-1"
        value={draft.order_by}
        onChange={(e) => setDraft({ ...draft, order_by: e.target.value })}
      />
    ) : (
      o.order_by || "—"
    )}
  </td>

  {/* Company */}
  <td>
    {isEdit ? (
      <input
        className="border rounded px-2 py-1"
        value={draft.company}
        onChange={(e) => setDraft({ ...draft, company: e.target.value })}
      />
    ) : (
      o.company || "—"
    )}
  </td>

  {/* Grade */}
  <td>
    {isEdit ? (
      <input
        className="border rounded px-2 py-1"
        value={draft.grade}
        onChange={(e) => setDraft({ ...draft, grade: e.target.value })}
      />
    ) : (
      o.grade || "—"
    )}
  </td>

  {/* Thickness */}
  <td>
    {isEdit ? (
      <input
        type="number"
        className="border rounded px-2 py-1 w-20"
        value={draft.thickness}
        onChange={(e) => setDraft({ ...draft, thickness: e.target.value })}
      />
    ) : (
      o.thickness_mm ?? "—"
    )}
  </td>

  {/* Op. Size */}
  <td>
    {isEdit ? (
      <input
        type="number"
        className="border rounded px-2 py-1 w-20"
        value={draft.op_size_mm}
        onChange={(e) => setDraft({ ...draft, op_size_mm: e.target.value })}
      />
    ) : (
      o.op_size_mm ?? "—"
    )}
  </td>

  {/* Ordered Pcs */}
  <td className="text-right">
    {isEdit ? (
      <input
        type="number"
        className="border rounded px-2 py-1 w-24 text-right"
        value={draft.ordered_qty}
        onChange={(e) => setDraft({ ...draft, ordered_qty: e.target.value })}
      />
    ) : (
      fmt(o.ordered_qty_pcs)
    )}
  </td>

  {/* Ordered Weight */}
  <td className="text-right">
    {isEdit ? (
      <input
        type="number"
        className="border rounded px-2 py-1 w-24 text-right"
        value={draft.ordered_weight_kg}
        onChange={(e) =>
          setDraft({ ...draft, ordered_weight_kg: e.target.value })
        }
      />
    ) : (
      fmt(o.ordered_weight_kg)
    )}
  </td>

  {/* Fulfilled / Remaining */}
  <td className="text-right">{fmt(o.fulfilled_weight_kg)}</td>
  <td className="text-right">{fmt(o.remaining_weight_kg)}</td>

  {/* Cancelled On */}
  <td className="pl-3">{o.cancelled_at || "—"}</td>
  <td className="pl-3">{o.cancel_remarks || "—"}</td>

  {/* Status */}
  <td className="pl-3 border-l border-slate-200">
    {renderStatus(o.status, o.cancelled_at)}
  </td>

  {/* Actions */}
  <td className="whitespace-nowrap pl-4">
    {isEdit ? (
      <>
        <button
          className="px-2 py-1 rounded bg-emerald-600 text-white"
          onClick={() => saveEdit(o.order_no)}
        >
          Save
        </button>
        <button
          className="px-2 py-1 rounded border ml-2"
          onClick={cancelEdit}
        >
          Cancel
        </button>
      </>
    ) : (
      <>
        <button
          className="px-2 py-1 rounded border"
          onClick={() => startEdit(o)}
        >
          Edit
        </button>
        <button
          className="px-2 py-1 rounded border border-rose-300 text-rose-600"
          onClick={() => cancelOrder(o.order_no)}
        >
          Cancel
        </button>
        <button
          className="px-2 py-1 text-red-600 border border-red-300 rounded hover:bg-red-50"
          onClick={() => deleteOrder(o.order_no)}
        >
          Del
        </button>
      </>
    )}
  </td>
</tr>
            );
          })}
          {!rows.length && (
            <tr>
              <td className="py-4 text-slate-500" colSpan={15}>
                {view === "cancelled" ? "No cancelled orders." : "No orders yet."}
              </td>
            </tr>
          )}
        </StickyTable>
      </Section>

      {/* Cancel popup */}
      {showCancelPrompt && (
        <div className="fixed inset-0 bg-black bg-opacity-30 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-lg w-96">
            <h2 className="text-lg font-semibold mb-4">Cancel Order</h2>
            <textarea
              value={cancelRemark}
              onChange={(e) => setCancelRemark(e.target.value)}
              placeholder="Enter cancellation remarks"
              className="w-full border rounded-lg p-2 mb-4"
              rows={3}
            />
            <div className="flex justify-end gap-2">
              <button
                className="px-4 py-2 rounded border"
                onClick={() => setShowCancelPrompt(null)}
              >
                Close
              </button>
              <button
                className="px-4 py-2 rounded bg-rose-600 text-white"
                onClick={confirmCancelOrder}
              >
                Confirm Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================= DISPATCHED =============================== */
function DispatchedTab() {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");
  const [gradeFilter, setGradeFilter] = useState("");

  const load = async () => {
    const res = await axios.get(`${API}/orders`, {
      params: {
        q,
        grade: gradeFilter || undefined,
        status: "Fulfilled", // ✅ fetch only dispatched orders
      },
    });
    setRows(res.data || []);
  };

  useEffect(() => {
    load();
  }, [q, gradeFilter]);

  const Head = ({ children, right, w, className = "" }) => (
    <th
      className={`whitespace-nowrap px-3 py-2.5 ${
        right ? "text-right" : "text-left"
      } ${className}`}
      style={{ width: w }}
    >
      {children}
    </th>
  );

  const renderStatus = () => (
    <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700 border border-emerald-200">
      Dispatched
    </span>
  );

  return (
    <div className="space-y-4">
      <Section
        title="Dispatched Orders"
        right={
          <div className="flex items-center gap-2">
            <ExportSheetButton tab="dispatched" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search company / grade / order"
              className="border rounded-lg px-3 py-2 w-64"
            />
            <label className="text-sm">
              <div className="text-slate-600 mb-1">Grade</div>
              <select
                value={gradeFilter}
                onChange={(e) => setGradeFilter(e.target.value)}
                className="border rounded-lg px-3 py-2"
              >
                <option value="">All Grades</option>
                {GRADES.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </label>
          </div>
        }
      >
<StickyTable
  headers={[
    { label: "Order No", className: "w-20" },
    { label: "Order Date", className: "w-28" },
    { label: "Order By", className: "w-36" },
    { label: "Company", className: "w-36" },
    { label: "Grade", className: "w-24" },
    { label: "Thickness", className: "w-24" },
    { label: "Op. Size (mm)", className: "w-28" },
    { label: "Ordered (kg)", className: "text-right w-36" },
    { label: "Fulfilled (kg)", className: "text-right w-36" },
    { label: "Status", className: "pl-3 w-36 border-l border-slate-200" },
  ]}
>
  {rows.length > 0 ? (
    rows.map((o) => (
      <tr key={o.order_no} className="border-t">
        <td className="px-3 py-2.5">{o.order_no}</td>
        <td className="px-3 py-2.5">{o.order_date || "—"}</td>
        <td className="px-3 py-2.5">{o.order_by || "—"}</td>
        <td className="px-3 py-2.5">{o.company || "—"}</td>
        <td className="px-3 py-2.5">{o.grade || "—"}</td>
        <td className="px-3 py-2.5">{o.thickness_mm ?? "—"}</td>
        <td className="px-3 py-2.5">{o.op_size_mm ?? "—"}</td>
        <td className="px-3 py-2.5 text-right">{fmt(o.ordered_weight_kg)}</td>
        <td className="px-3 py-2.5 text-right">{fmt(o.fulfilled_weight_kg)}</td>
        <td className="px-3 py-2.5 border-l border-slate-200">{renderStatus()}</td>
      </tr>
    ))
  ) : (
    <tr>
      <td className="py-4 text-slate-500 text-center" colSpan={10}>
        No dispatched orders.
      </td>
    </tr>
  )}
</StickyTable>
      </Section>
    </div>
  );
}


/* ================================== COILS ================================== */
function Coils({ onStartedCircle }) {
  const [list, setList] = useState([]);
  const [q, setQ] = useState("");
  const [gradeFilter, setGradeFilter] = useState("");
  const [operatorFilter, setOperatorFilter] = useState("");
  const [selected, setSelected] = useState(null);
  const [editingCoil, setEditingCoil] = useState(false);
  const [editDraft, setEditDraft] = useState({});
  const [importResult, setImportResult] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [showStartForm, setShowStartForm] = useState(false);

  // NEW: bulk start controls reuse the same operator/date inputs
  const [startRun, setStartRun] = useState({
    operator: OPERATORS[0],
    run_date: "",
  });

  // NEW: ref for auto-scroll + flash when viewing a coil
  const overviewRef = useRef(null);
  const [flashOverview, setFlashOverview] = useState(false);

  const [newCoil, setNewCoil] = useState({
    rn: "",
    grade: "304",
    thickness: "",
    width: "",
    supplier: "",
    purchase_weight_kg: "",
    purchase_date: "",
    purchase_price: "",
  });

  const load = async () => {
    const res = await axios.get(`${API}/coils`, {
      params: {
        q,
        grade: gradeFilter || undefined,
        operator: operatorFilter || undefined,
        limit: 200,
      },
    });
    setList(res.data || []);
    setSelectedIds([]);
  };
  useEffect(() => {
    load();
  }, [q, gradeFilter, operatorFilter]);

  // Auto-scroll to overview whenever a new coil is selected
  useEffect(() => {
    if (selected?.summary && overviewRef.current) {
      // Smoothly scroll into view
      overviewRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      // Flash highlight briefly
      setFlashOverview(true);
      const t = setTimeout(() => setFlashOverview(false), 1200);
      return () => clearTimeout(t);
    }
  }, [selected?.summary?.id]);

  const loadSummary = async (id) =>
    setSelected({
      summary: (await axios.get(`${API}/coils/${id}/summary`)).data,
    });

  const createCoil = async (e) => {
    e.preventDefault();
    const payload = {
      rn: newCoil.rn || null,
      grade: newCoil.grade || null,
      thickness: newCoil.thickness ? Number(newCoil.thickness) : null,
      width: newCoil.width ? Number(newCoil.width) : null,
      supplier: newCoil.supplier || null,
      purchase_weight_kg: Number(newCoil.purchase_weight_kg || 0),
      purchase_date: newCoil.purchase_date || undefined,
      purchase_price:
        newCoil.purchase_price === "" ? null : Number(newCoil.purchase_price),
    };
    if (!payload.purchase_weight_kg || payload.purchase_weight_kg <= 0)
      return alert("Purchase weight must be > 0");
    const res = await axios.post(`${API}/coils/purchase`, payload);
    setNewCoil({
      rn: "",
      grade: "304",
      thickness: "",
      width: "",
      supplier: "",
      purchase_weight_kg: "",
      purchase_date: "",
      purchase_price: "",
    });
    await load();
    await loadSummary(res.data.id);
  };

  const startCircleRun = async (e) => {
    e.preventDefault();
    const coilId = selected?.summary?.id;
    if (!coilId) return alert("Select a coil (click View) first.");
    try {
      const row = (
        await axios.post(`${API}/circle-runs`, {
          coil_id: coilId,
          operator: startRun.operator,
          run_date: startRun.run_date || undefined,
        })
      ).data;
      onStartedCircle(row.id);
    } catch (error) {
      if (error.response && error.response.status === 409) {
        alert(error.response.data.error);
      } else {
        console.error("Failed to start circle run:", error);
        alert("Failed to start circle run. Check console for details.");
      }
    }
  };

  // Bulk start using new backend endpoint
  const bulkStartCircle = async () => {
    if (!selectedIds.length) return alert("Select at least one coil.");
    try {
      const { data } = await axios.post(`${API}/circle-runs/bulk-start`, {
        coil_ids: selectedIds,
        operator: startRun.operator,
        run_date: startRun.run_date || undefined,
      });
      // Navigate to first created run if any, same as single
      if (data.first_run_id) onStartedCircle(data.first_run_id);
      alert(`Started: ${data.started}, Skipped: ${data.skipped}`);
      setSelectedIds([]);
    } catch (e) {
      console.error(e);
      alert("Bulk start failed");
    }
  };

  const deleteCoil = async (id) => {
    if (!confirm("Delete this coil? This will also delete all associated runs."))
      return;
    try {
      await axios.delete(`${API}/coils/${id}`);
      setSelected(null);
      load();
    } catch {
      alert("Error deleting coil");
    }
  };

  // Bulk delete (unchanged)
  const bulkDelete = async () => {
    if (!selectedIds.length) return alert("No coils selected.");
    if (!confirm(`Delete ${selectedIds.length} coils? This cannot be undone.`))
      return;
    try {
      await axios.post(`${API}/coils/bulk-delete`, { ids: selectedIds });
      setSelected(null);
      await load();
    } catch {
      alert("Error deleting selected coils");
    }
  };

  const toggleSelect = (id) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === list.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(list.map((row) => row.id));
    }
  };

  const s = selected?.summary;

  const beginEditCoil = () => {
    if (!s) return;
    setEditingCoil(true);
    setEditDraft({
      rn: s.rn || "",
      grade: s.grade || "",
      thickness: s.thickness ?? "",
      width: s.width ?? "",
      supplier: s.supplier || "",
      purchase_date: s.purchase_date || "",
      purchase_weight_kg: s.purchased_kg ?? "",
      purchase_price: s.purchase_price ?? "",
    });
  };
  const cancelEditCoil = () => {
    setEditingCoil(false);
    setEditDraft({});
  };
  const saveEditCoil = async () => {
    try {
      await axios.patch(`${API}/coils/${s.id}`, {
        rn: nullIfEmpty(editDraft.rn),
        grade: nullIfEmpty(editDraft.grade),
        thickness: toNum(editDraft.thickness),
        width: toNum(editDraft.width),
        supplier: nullIfEmpty(editDraft.supplier),
        purchase_date: nullIfEmpty(editDraft.purchase_date),
        purchase_weight_kg: toNum(editDraft.purchase_weight_kg),
        purchase_price: toNum(editDraft.purchase_price),
      });
      await loadSummary(s.id);
      await load();
      cancelEditCoil();
    } catch {
      alert("Failed to save coil");
    }
  };
  const nullIfEmpty = (v) => (v === "" ? null : v);
  const toNum = (v) =>
    v === "" || v === null || v === undefined ? null : Number(v);

  // Import handler (unchanged)
  const handleImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    try {
      const token = localStorage.getItem("token");
      const res = await axios.post(`${API}/coils/import`, formData, {
        headers: {
          Authorization: token ? `Bearer ${token}` : "",
          "Content-Type": "multipart/form-data",
        },
      });
      setImportResult({ type: "success", data: res.data });
      await load();
    } catch (err) {
      console.error("❌ Import failed", err);
      setImportResult({
        type: "error",
        error: err.response?.data?.error || "Import failed",
      });
    } finally {
      e.target.value = "";
    }
  };

  return (
    <div className="space-y-4">
      <Section
        title="Coils"
        right={
          <div className="flex items-center gap-2">
            <ExportSheetButton tab="coils" />
            <label className="bg-emerald-600 text-white px-3 py-2 rounded-lg cursor-pointer">
              Import Excel
              <input
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={handleImport}
              />
            </label>

{/* Bulk actions */}
<button
  onClick={bulkDelete}
  className="bg-red-600 text-white px-3 py-2 rounded-lg disabled:opacity-50"
  disabled={!selectedIds.length}
>
  Delete Selected
</button>

{/* Bulk start: cleaner UI */}
<div className="relative">
  <button
    onClick={() => setShowStartForm(!showStartForm)}
    className="bg-indigo-600 text-white px-3 py-2 rounded-lg disabled:opacity-50"
    disabled={!selectedIds.length}
  >
    Go to Circle
  </button>

  {showStartForm && (
    <div className="absolute mt-2 bg-white border border-slate-200 rounded-lg shadow-lg p-3 z-20 flex gap-2">
      <label className="text-sm">
        <div className="text-slate-600 mb-1">Operator</div>
        <select
          value={startRun.operator}
          onChange={(e) => setStartRun({ ...startRun, operator: e.target.value })}
          className="border rounded-lg px-3 py-2"
        >
          {OPERATORS.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      </label>

      <label className="text-sm">
        <div className="text-slate-600 mb-1">Date</div>
        <input
          type="date"
          value={startRun.run_date}
          onChange={(e) => setStartRun({ ...startRun, run_date: e.target.value })}
          className="border rounded-lg px-3 py-2"
        />
      </label>

      <button
        onClick={bulkStartCircle}
        className="bg-emerald-600 text-white px-3 py-2 rounded-lg self-end"
      >
        Confirm Start
      </button>
    </div>
  )}
</div>

            {/* Search/filters (unchanged) */}
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search RN / Supplier"
              className="border rounded-lg px-3 py-2 w-56"
            />
            <select
              value={gradeFilter}
              onChange={(e) => setGradeFilter(e.target.value)}
              className="border rounded-lg px-3 py-2"
            >
              <option value="">All Grades</option>
              {GRADES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
            <select
              value={operatorFilter}
              onChange={(e) => setOperatorFilter(e.target.value)}
              className="border rounded-lg px-3 py-2"
            >
              <option value="">All Operators</option>
              {OPERATORS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
        }
      >
        {/* Import result message */}
        {importResult && (
          <div
            className={`p-2 mb-3 rounded ${
              importResult.type === "success"
                ? "bg-green-100 text-green-700"
                : "bg-red-100 text-red-700"
            }`}
          >
            {importResult.type === "success" ? (
              <>✅ Imported: {importResult.data.inserted}, Skipped: {importResult.data.skipped}</>
            ) : (
              <>❌ {importResult.error}</>
            )}
          </div>
        )}

        {/* New coil form (unchanged) */}
        <form
          onSubmit={createCoil}
          className="grid grid-cols-2 md:grid-cols-8 gap-3 mb-3"
        >
          <Input
            label="S.No."
            value={newCoil.rn}
            onChange={(e) => setNewCoil({ ...newCoil, rn: e.target.value })}
            required
          />
          <label className="text-sm">
            <div className="text-slate-600 mb-1">Grade</div>
            <select
              value={newCoil.grade}
              onChange={(e) => setNewCoil({ ...newCoil, grade: e.target.value })}
              className="border rounded-lg px-3 py-2"
            >
              {GRADES.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </label>
          <NumberInput
            label="Thickness (mm)"
            value={newCoil.thickness}
            onChange={(e) =>
              setNewCoil({ ...newCoil, thickness: e.target.value })
            }
          />
          <NumberInput
            label="Width (mm)"
            value={newCoil.width}
            onChange={(e) => setNewCoil({ ...newCoil, width: e.target.value })}
          />
          <Input
            label="Supplier"
            value={newCoil.supplier}
            onChange={(e) => setNewCoil({ ...newCoil, supplier: e.target.value })}
          />
          <NumberInput
            label="Purchase Weight (kg)"
            required
            value={newCoil.purchase_weight_kg}
            onChange={(e) =>
              setNewCoil({ ...newCoil, purchase_weight_kg: e.target.value })
            }
          />
          <Input
            label="Purchase Date"
            type="date"
            value={newCoil.purchase_date}
            onChange={(e) =>
              setNewCoil({ ...newCoil, purchase_date: e.target.value })
            }
          />
          <NumberInput
            label="Purchase Price (₹/kg)"
            value={newCoil.purchase_price}
            onChange={(e) =>
              setNewCoil({ ...newCoil, purchase_price: e.target.value })
            }
          />
          <div>
            <button className="bg-sky-600 text-white rounded-lg px-3 py-2 w-full h-full">
              Save
            </button>
          </div>
        </form>

        {/* Coils table */}
<div className="overflow-y-auto overflow-x-auto max-h-[70vh] border rounded">
  <table className="w-full text-sm">
    <thead className="text-left text-slate-600 sticky top-0 bg-gray-100 z-10 shadow-sm">
      <tr>
        <th className="py-2">
          <input
            type="checkbox"
            checked={selectedIds.length === list.length && list.length > 0}
            onChange={toggleSelectAll}
          />
        </th>
        <th className="py-2">RN</th>
        <th>Grade</th>
        <th>Spec</th>
        <th>Supplier</th>
        <th>Purchased On</th>
        <th className="text-right">Purchased (kg)</th>
        <th className="text-right">Purchase Price (₹/kg)</th>
        <th className="text-right">Direct Sold (kg)</th>
        <th className="text-right">Circles (kg)</th>
        <th className="text-right">Patta (kg)</th>
        <th className="text-right">PL (kg)</th>
        <th className="text-right">Scrap (kg)</th>
        <th className="text-right">Balance (kg)</th>
        <th></th>
      </tr>
    </thead>
    <tbody className="[&>tr:nth-child(odd)]:bg-slate-50">
      {list.map((row) => (
        <tr key={row.id} className="border-t">
          <td>
            <input
              type="checkbox"
              checked={selectedIds.includes(row.id)}
              onChange={() => toggleSelect(row.id)}
            />
          </td>
          <td className="py-2 font-medium">{String(row.rn)}</td>
          <td>{row.grade || "—"}</td>
          <td>
            {[row.thickness ? `${row.thickness}mm` : null, row.width ? `${row.width}mm` : null]
              .filter(Boolean)
              .join(" × ") || "—"}
          </td>
          <td>{row.supplier || "—"}</td>
          <td>{row.purchase_date || "—"}</td>
          <td className="text-right">{fmt(row.purchased_kg)}</td>
          <td className="text-right">
            {row.purchase_price == null ? "—" : Number(row.purchase_price).toFixed(2)}
          </td>
          <td className="text-right">{fmt(row.direct_sold_kg)}</td>
          <td className="text-right">{fmt(row.circles_kg)}</td>
          <td className="text-right">{fmt(row.patta_kg)}</td>
          <td className="text-right">{fmt(row.pl_kg)}</td>
          <td className="text-right">{fmt(row.scrap_kg)}</td>
          <td className="text-right font-semibold">{fmt(row.balance_kg)}</td>
          <td className="text-right">
            <div className="flex gap-1">
              <button
                className="px-2 py-1 border rounded"
                onClick={() => loadSummary(row.id)}
              >
                View
              </button>
              <button
                className="px-2 py-1 text-red-600 border border-red-300 rounded hover:bg-red-50"
                onClick={() => deleteCoil(row.id)}
              >
                Del
              </button>
            </div>
          </td>
        </tr>
      ))}
      {!list.length && (
        <tr>
          <td className="py-4 text-slate-500" colSpan={15}>
            No coils yet.
          </td>
        </tr>
      )}
    </tbody>
  </table>
</div>
      </Section>

      {/* Overview + Start Circle Run + Edit Coil */}
      {s && (
        <Section
          ref={overviewRef}
          title={`RN ${s.rn} — Overview`}
        >
          <div className={`grid md:grid-cols-3 gap-3 ${flashOverview ? "ring-2 ring-indigo-400 rounded-lg" : ""}`}>
            {/* Specs */}
            <div className="bg-slate-50 rounded-lg p-3">
              <div className="font-semibold mb-2">Specs</div>
              {!editingCoil ? (
                <>
                  <div className="text-sm space-y-1">
                    <div><b>Grade:</b> {s.grade || "—"}</div>
                    <div><b>Thickness:</b> {s.thickness ?? "—"} mm</div>
                    <div><b>Width:</b> {s.width ?? "—"} mm</div>
                    <div><b>Supplier:</b> {s.supplier || "—"}</div>
                    <div><b>Purchased On:</b> {s.purchase_date || "—"}</div>
                    <div>
                      <b>Purchase Price:</b>{" "}
                      {s.purchase_price == null ? "—" : Number(s.purchase_price).toFixed(2)} ₹/kg
                    </div>
                    <div><b>Last Sale Date:</b> {fmtDate(s.last_sale_at)}</div>
                  </div>
                  <button
                    className="mt-3 px-3 py-2 border rounded"
                    onClick={beginEditCoil}
                  >
                    Edit Coil
                  </button>
                </>
              ) : (
                <div className="text-sm space-y-2">
                  <Input
                    label="S.No."
                    value={editDraft.rn}
                    onChange={(e) =>
                      setEditDraft({ ...editDraft, rn: e.target.value })
                    }
                  />
                  <label className="text-sm">
                    <div className="text-slate-600 mb-1">Grade</div>
                    <select
                      value={editDraft.grade}
                      onChange={(e) =>
                        setEditDraft({ ...editDraft, grade: e.target.value })
                      }
                      className="border rounded-lg px-3 py-2 w-full"
                    >
                      {GRADES.map((g) => (
                        <option key={g} value={g}>{g}</option>
                      ))}
                    </select>
                  </label>
                  <NumberInput
                    label="Thickness (mm)"
                    value={editDraft.thickness}
                    onChange={(e) =>
                      setEditDraft({ ...editDraft, thickness: e.target.value })
                    }
                  />
                  <NumberInput
                    label="Width (mm)"
                    value={editDraft.width}
                    onChange={(e) =>
                      setEditDraft({ ...editDraft, width: e.target.value })
                    }
                  />
                  <Input
                    label="Supplier"
                    value={editDraft.supplier}
                    onChange={(e) =>
                      setEditDraft({ ...editDraft, supplier: e.target.value })
                    }
                  />
                  <Input
                    label="Purchase Date"
                    type="date"
                    value={editDraft.purchase_date}
                    onChange={(e) =>
                      setEditDraft({
                        ...editDraft,
                        purchase_date: e.target.value,
                      })
                    }
                  />
                  <NumberInput
                    label="Purchase Weight (kg)"
                    value={editDraft.purchase_weight_kg}
                    onChange={(e) =>
                      setEditDraft({
                        ...editDraft,
                        purchase_weight_kg: e.target.value,
                      })
                    }
                  />
                  <NumberInput
                    label="Purchase Price (₹/kg)"
                    value={editDraft.purchase_price}
                    onChange={(e) =>
                      setEditDraft({
                        ...editDraft,
                        purchase_price: e.target.value,
                      })
                    }
                  />
                  <div className="flex gap-2">
                    <button
                      className="px-3 py-2 rounded bg-emerald-600 text-white"
                      onClick={saveEditCoil}
                    >
                      Save
                    </button>
                    <button
                      className="px-3 py-2 rounded border"
                      onClick={cancelEditCoil}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Quantities */}
            <div className="bg-slate-50 rounded-lg p-3">
              <div className="font-semibold mb-2">Quantities (kg)</div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <StatCell label="Purchased" value={s.purchased_kg} />
                <StatCell label="Direct Sold" value={s.direct_sold_kg} />
                <StatCell label="Circles Sold" value={s.circles_sold_kg} />
                <StatCell label="Patta" value={s.patta_kg} />
                <StatCell label="Scrap" value={s.scrap_kg} />
                <StatCell label="Balance" value={s.balance_kg} bold />
              </div>
            </div>

            {/* Start Circle Run (single) */}
            <div className="bg-slate-50 rounded-lg p-3">
              <div className="font-semibold mb-2">
                Start Circle Run (only Operator + Date)
              </div>
              <form onSubmit={startCircleRun} className="grid grid-cols-2 gap-2">
                <label className="text-sm">
                  <div className="text-slate-600 mb-1">Operator</div>
                  <select
                    value={startRun.operator}
                    onChange={(e) =>
                      setStartRun({ ...startRun, operator: e.target.value })
                    }
                    className="border rounded-lg px-3 py-2"
                  >
                    {OPERATORS.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </select>
                </label>
                <Input
                  label="Run Date"
                  type="date"
                  value={startRun.run_date}
                  onChange={(e) =>
                    setStartRun({ ...startRun, run_date: e.target.value })
                  }
                />
                <div className="col-span-2">
                  <button className="bg-indigo-600 text-white rounded-lg px-3 py-2 w-full">
                    Start & Go to Circle
                  </button>
                </div>
              </form>
              <div className="text-xs text-slate-500 mt-2">
                For multiple coils, select rows above and click <b>Go to Circle</b>.
              </div>
            </div>
          </div>
        </Section>
      )}
    </div>
  );
}

function StatCell({ label, value, bold }) {
  return (
    <div className="bg-white rounded border p-2">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={`text-sm ${bold ? "font-semibold" : ""}`}>
        {fmt(value)}
      </div>
    </div>
  );
}

/* ================================= CIRCLE ================================= */
function CircleTab({ focusId }) {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");
  const [operator, setOperator] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState({});
  const rowRefs = useRef({});

  const load = async () => {
    const res = await axios.get(`${API}/circle-runs`, {
      params: {
        q,
        operator: operator || undefined,
        from: from || undefined,
        to: to || undefined,
      },
    });
    setRows(res.data || []);
  };
  useEffect(() => {
    load();
  }, [q, operator, from, to]);

  // focus new row after create
  useEffect(() => {
    if (focusId && rowRefs.current[focusId]) {
      rowRefs.current[focusId].scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      rowRefs.current[focusId].classList.add("bg-yellow-50");
      const t = setTimeout(
        () => rowRefs.current[focusId]?.classList.remove("bg-yellow-50"),
        1800
      );
      return () => clearTimeout(t);
    }
  }, [rows, focusId]);

  const startEdit = (r) => {
    setEditingId(r.id);
    setDraft({
      run_date: r.run_date || "",
      operator: r.operator || "",
      net_weight_kg: r.net_weight_kg ?? "",
      op_size_mm: r.op_size_mm ?? "",
      circle_weight_kg: r.circle_weight_kg ?? "",
      qty: r.qty ?? "",
      scrap_weight_kg: r.scrap_weight_kg ?? "",
      patta_size: r.patta_size || "",
      patta_weight_kg: r.patta_weight_kg ?? "",
      pl_size: r.pl_size || "",
      pl_weight_kg: r.pl_weight_kg ?? ""
    });
  };
  const cancelEdit = () => {
    setEditingId(null);
    setDraft({});
  };
  const saveEdit = async (id) => {
    const payload = {
      run_date: draft.run_date || null,
      operator: draft.operator || null,
      net_weight_kg: toNum(draft.net_weight_kg),
      op_size_mm: toNum(draft.op_size_mm),
      circle_weight_kg: toNum(draft.circle_weight_kg),
      qty: toNum(draft.qty),
      scrap_weight_kg: toNum(draft.scrap_weight_kg),
      patta_size: draft.patta_size || null,
      patta_weight_kg: toNum(draft.patta_weight_kg),
      	pl_size: draft.pl_size || null,
      pl_weight_kg: toNum(draft.pl_weight_kg),
    };
    try {
      await axios.patch(`${API}/circle-runs/${id}`, payload);
      await load();
      cancelEdit();
   } catch (error) {
  console.error("Failed to save circle run:", error);
  const msg =
    error?.response?.data?.error ||
    error?.response?.data?.message ||
    error?.message ||
    "Failed to save circle run.";
  alert(msg);
}
  };
  const toNum = (v) => {
  if (v === "" || v == null) return null;
  const cleaned = String(v).replace(/[^\d.-]/g, ""); // remove commas/spaces
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

  const deleteRun = async (id) => {
    if (!confirm("Delete this circle run?")) return;
    try {
      await axios.delete(`${API}/circle-runs/${id}`);
      load();
    } catch {
      alert("Error deleting run");
    }
  };

  // derived
  const yieldPct = (r) => {
    const net = Number(r.net_weight_kg || 0);
    const circ = Number(r.circle_weight_kg || 0);
    return net > 0 ? (100 * circ) / net : 0;
  };
  const balance = (r) => {
    const net = Number(r.net_weight_kg || 0);
    const circ = Number(r.circle_weight_kg || 0);
    const scrap = Number(r.scrap_weight_kg || 0);
    const patta = Number(r.patta_weight_kg || 0);
    const pl = Number(r.pl_weight_kg || 0);
    return net - circ - scrap - patta - pl;
  };

const Head = ({ children, w, right, className = "" }) => (
  <th
    className={`whitespace-nowrap px-3 py-2 ${right ? "text-right" : "text-left"} ${className}`}
    style={{ width: w }}
  >
    {children}
  </th>
);

  const exportCSV = () => {
    const headers = [
      "Date",
      "Coil RN",
      "Operator",
      "Grade",
      "Thickness",
      "Width",
      "Net weight",
      "Op. size",
      "Circle weight",
      "Pcs",
      "Scrap",
      "Patta Size",
      "Patta weight",
      "PL Size",
      "PL weight",
      "Balance",
      "Yield %",
    ];
    const lines = [headers.join(",")];
    rows.forEach((r) => {
      const y = yieldPct(r);
      const b = balance(r);
      const vals = [
        r.run_date || "",
        r.rn || "",
        r.operator || "",
        r.grade || "",
        r.thickness ?? "",
        r.width ?? "",
        r.net_weight_kg ?? "",
        r.op_size_mm ?? "",
        r.circle_weight_kg ?? "",
        r.qty ?? "",
        r.scrap_weight_kg ?? "",
        r.patta_size || "",
        r.patta_weight_kg ?? "",
        r.pl_size || "",
        r.pl_weight_kg ?? "",
        b,
        y.toFixed(2),
      ].map((x) => (x === null || x === undefined ? "" : String(x)));
      lines.push(vals.map(csvEscape).join(","));
    });
    downloadCSV("circle_runs.csv", lines.join("\n"));
  };
  const csvEscape = (v) => {
    if (v.includes(",") || v.includes('"') || v.includes("\n")) {
      return `"${v.replace(/"/g, '""')}"`;
    }
    return v;
  };
  const downloadCSV = (filename, content) => {
    const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Section
      title="Circle — Production Runs (Auto-Stock Update)"
      right={
  <div className="flex items-center gap-2">
    <Input
      label="From"
      type="date"
      value={from}
      onChange={(e) => setFrom(e.target.value)}
    />
    <Input
      label="To"
      type="date"
      value={to}
      onChange={(e) => setTo(e.target.value)}
    />
    <label className="text-sm">
      <div className="text-slate-600 mb-1">Operator</div>
      <select
        value={operator}
        onChange={(e) => setOperator(e.target.value)}
        className="border rounded-lg px-3 py-2"
      >
        <option value="">All</option>
        {OPERATORS.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </label>
    <input
      value={q}
      onChange={(e) => setQ(e.target.value)}
      placeholder="Search RN / Grade"
      className="border rounded-lg px-3 py-2 w-48"
    />

    {/* 👇 New Excel Export button */}
    <ExportSheetButton tab="circle_runs" />

    <button
      onClick={exportCSV}
      className="bg-emerald-600 text-white rounded-lg px-3 py-2"
    >
      Export CSV
    </button>
  </div>
}
    >
      <div className="text-xs text-slate-600 mb-3 bg-blue-50 p-2 rounded">
        <b>Note:</b> Circle production automatically updates stock. Use Stock & Sales tab to record actual sales.
      </div>

      <StickyTable
  headers={[
    { label: "Date", className: "w-40" },
    { label: "Coil RN no.", className: "w-44" },
    { label: "Operator", className: "w-40" },
    { label: "Grade", className: "w-28" },
    { label: "Thickness", className: "w-32" },
    { label: "Width", className: "w-32" },
    { label: "Net weight", className: "text-right w-44" },
    { label: "Op. size", className: "text-right w-36" },
    { label: "Circle weight", className: "text-right w-44" },
    { label: "Pcs", className: "text-right w-28" },
    { label: "Scrap", className: "text-right w-44" },
    { label: "Patta Size", className: "text-right w-40" },
    { label: "Patta weight", className: "text-right w-48" },
    { label: "PL Size", className: "text-right w-40" },
    { label: "PL weight", className: "text-right w-48" },
    { label: "Balance", className: "text-right w-40" },
    { label: "Yield %", className: "text-right w-28" },
    { label: "", className: "w-36" },
  ]}
>
  {rows.map((r) => {
    const isEdit = editingId === r.id;
    const y = isEdit
      ? (() => {
          const net = Number(draft.net_weight_kg || 0);
          const circ = Number(draft.circle_weight_kg || 0);
          return net > 0 ? (100 * circ) / net : 0;
        })()
      : yieldPct(r);
    const b = isEdit
      ? (() => {
          const net = Number(draft.net_weight_kg || 0);
          const circ = Number(draft.circle_weight_kg || 0);
          const scrap = Number(draft.scrap_weight_kg || 0);
          const patta = Number(draft.patta_weight_kg || 0);
          const pl = Number(draft.pl_weight_kg || 0);
          return net - circ - scrap - patta - pl;
        })()
      : balance(r);

    return (
      <tr
        key={r.id}
        ref={(el) => (rowRefs.current[r.id] = el)}
        className="border-t"
      >
        {/* Date */}
        <td>
          {isEdit ? (
            <input
              type="date"
              value={draft.run_date}
              onChange={(e) =>
                setDraft({ ...draft, run_date: e.target.value })
              }
              className="border rounded px-2 py-1 w-[130px]"
            />
          ) : (
            r.run_date || "—"
          )}
        </td>

        {/* RN */}
        <td>{r.rn}</td>

        {/* Operator */}
        <td>
          {isEdit ? (
            <select
              value={draft.operator}
              onChange={(e) =>
                setDraft({ ...draft, operator: e.target.value })
              }
              className="border rounded px-2 py-1 w-[130px]"
            >
              <option value="">—</option>
              {OPERATORS.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          ) : (
            r.operator || "—"
          )}
        </td>

        {/* Spec */}
        <td>{r.grade || "—"}</td>
        <td>{r.thickness ?? "—"}</td>
        <td>{r.width ?? "—"}</td>

        {/* Numbers */}
        <td className="text-right">
          {isEdit ? (
            <NumCell
              val={draft.net_weight_kg}
              on={(v) => setDraft({ ...draft, net_weight_kg: v })}
              w={110}
            />
          ) : (
            fmt(r.net_weight_kg)
          )}
        </td>
        <td className="text-right">
          {isEdit ? (
            <NumCell
              val={draft.op_size_mm}
              on={(v) => setDraft({ ...draft, op_size_mm: v })}
              w={80}
            />
          ) : (
            r.op_size_mm ?? "—"
          )}
        </td>
        <td className="text-right">
          {isEdit ? (
            <NumCell
              val={draft.circle_weight_kg}
              on={(v) => setDraft({ ...draft, circle_weight_kg: v })}
              w={110}
            />
          ) : (
            fmt(r.circle_weight_kg)
          )}
        </td>
        <td className="text-right">
          {isEdit ? (
            <NumCell
              val={draft.qty}
              on={(v) => setDraft({ ...draft, qty: v })}
              w={80}
            />
          ) : (
            fmt(r.qty)
          )}
        </td>
        <td className="text-right">
          {isEdit ? (
            <NumCell
              val={draft.scrap_weight_kg}
              on={(v) => setDraft({ ...draft, scrap_weight_kg: v })}
              w={95}
            />
          ) : (
            fmt(r.scrap_weight_kg)
          )}
        </td>
        <td className="text-right">
          {isEdit ? (
            <input
              value={draft.patta_size}
              onChange={(e) =>
                setDraft({ ...draft, patta_size: e.target.value })
              }
              className="border rounded px-2 py-1 w-[95px] text-right"
            />
          ) : (
            r.patta_size || "—"
          )}
        </td>
        <td className="text-right">
          {isEdit ? (
            <NumCell
              val={draft.patta_weight_kg}
              on={(v) => setDraft({ ...draft, patta_weight_kg: v })}
              w={110}
            />
          ) : (
            fmt(r.patta_weight_kg)
          )}
        </td>
        <td className="text-right">
          {isEdit ? (
            <input
              value={draft.pl_size}
              onChange={(e) =>
                setDraft({ ...draft, pl_size: e.target.value })
              }
              className="border rounded px-2 py-1 w-[95px] text-right"
            />
          ) : (
            r.pl_size || "—"
          )}
        </td>
        <td className="text-right">
          {isEdit ? (
            <NumCell
              val={draft.pl_weight_kg}
              on={(v) => setDraft({ ...draft, pl_weight_kg: v })}
              w={110}
            />
          ) : (
            fmt(r.pl_weight_kg)
          )}
        </td>

        {/* Derived */}
        <td className="text-right font-medium">{fmt(b)}</td>
        <td className="text-right">{y.toFixed(2)}</td>

        {/* Actions */}
        <td className="whitespace-nowrap">
          {isEdit ? (
            <div className="flex gap-1">
              <button
                className="px-2 py-1 rounded bg-emerald-600 text-white"
                onClick={() => saveEdit(r.id)}
              >
                Save
              </button>
              <button
                className="px-2 py-1 rounded border"
                onClick={cancelEdit}
                type="button"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex gap-1">
              <button
                className="px-2 py-1 rounded border"
                onClick={() => startEdit(r)}
              >
                Edit
              </button>
              <button
                className="px-2 py-1 text-red-600 border border-red-300 rounded hover:bg-red-50"
                onClick={() => deleteRun(r.id)}
              >
                Del
              </button>
            </div>
          )}
        </td>
      </tr>
    );
  })}
  {!rows.length && (
    <tr>
      <td className="py-4 text-slate-500 text-center" colSpan={18}>
        No runs found.
      </td>
    </tr>
  )}
</StickyTable>
    </Section>
  );
}


/* ================================= PATTA ================================== */
function PattaTab() {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");
  const [operator, setOperator] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState({});
  const [availablePatta, setAvailablePatta] = useState([]);
  const [usedPattaIds, setUsedPattaIds] = useState(new Set());
  const [showAddForm, setShowAddForm] = useState(false);
  const [newRun, setNewRun] = useState({
    patta_source_id: "",
    source_type: "circle",
    run_date: "",
    operator: OPERATORS[0],
    grade: "",
    patta_size: "",
    net_weight_kg: "",
    op_size_mm: "",
    circle_weight_kg: "",
    qty: "",
    scrap_weight_kg: "",
  });

  const load = async () => {
    const res = await axios.get(`${API}/patta-runs`, {
      params: {
        q,
        operator: operator || undefined,
        from: from || undefined,
        to: to || undefined,
      },
    });
    setRows(res.data || []);
  };

  const loadAvailablePatta = async () => {
    const res = await axios.get(`${API}/patta`);
    setAvailablePatta(res.data || []);
    // find patta used as a source (prevent double use)
    const runs = await axios.get(`${API}/patta-runs`);
    const usedIds = new Set(
      (runs.data || [])
        .filter((r) => r.source_type === "patta")
        .map((r) => r.patta_source_id)
    );
    setUsedPattaIds(usedIds);
  };

  useEffect(() => {
    load();
    loadAvailablePatta();
  }, [q, operator, from, to]);

  const startEdit = (r) => {
    setEditingId(r.id);
    setDraft({
      run_date: r.run_date || "",
      operator: r.operator || "",
      grade: r.grade || "",
      patta_size: r.patta_size ?? "",
      net_weight_kg: r.net_weight_kg ?? "",
      op_size_mm: r.op_size_mm ?? "",
      circle_weight_kg: r.circle_weight_kg ?? "",
      qty: r.qty ?? "",
      scrap_weight_kg: r.scrap_weight_kg ?? "",
      thickness_mm: r.thickness_mm ?? null,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft({});
  };

  const saveEdit = async (id) => {
    const payload = {
      run_date: draft.run_date || null,
      operator: draft.operator || null,
      grade: draft.grade || null,
      net_weight_kg: toNum(draft.net_weight_kg),
      op_size_mm: toNum(draft.op_size_mm),
      circle_weight_kg: toNum(draft.circle_weight_kg),
      qty: toNum(draft.qty),
      scrap_weight_kg: toNum(draft.scrap_weight_kg),
    };
    try {
      await axios.patch(`${API}/patta-runs/${id}`, payload);
      await load();
      cancelEdit();
    } catch (error) {
      console.error("Failed to save patta run:", error);
      alert("Failed to save patta run. Check console for details.");
    }
  };

  const createPattaRun = async (e) => {
    e.preventDefault();
    const payload = {
      patta_source_id: Number(newRun.patta_source_id),
      source_type: newRun.source_type,
      run_date: newRun.run_date || undefined,
      operator: newRun.operator || null,
      grade: newRun.grade || null,
      patta_size: toNum(newRun.patta_size),
      net_weight_kg: toNum(newRun.net_weight_kg),
      op_size_mm: toNum(newRun.op_size_mm),
      circle_weight_kg: toNum(newRun.circle_weight_kg),
      qty: toNum(newRun.qty),
      scrap_weight_kg: toNum(newRun.scrap_weight_kg),
    };

    if (!payload.patta_source_id) return alert("Please select a patta source");

    await axios.post(`${API}/patta-runs`, payload);
    setNewRun({
      patta_source_id: "",
      source_type: "circle",
      run_date: "",
      operator: OPERATORS[0],
      grade: "",
      patta_size: "",
      net_weight_kg: "",
      op_size_mm: "",
      circle_weight_kg: "",
      qty: "",
      scrap_weight_kg: "",
    });
    setShowAddForm(false);
    await load();
    await loadAvailablePatta();
  };

  const deleteRun = async (id) => {
    if (!confirm("Delete this patta run?")) return;
    try {
      await axios.delete(`${API}/patta-runs/${id}`);
      load();
      loadAvailablePatta();
    } catch {
      alert("Error deleting run");
    }
  };

  const toNum = (v) => {
  if (v === "" || v == null) return null;
  const cleaned = String(v).replace(/[^\d.-]/g, ""); // keep only digits, dot, minus
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

  // derived
  const yieldPct = (r) => {
    const net = Number(r.net_weight_kg || 0);
    const circ = Number(r.circle_weight_kg || 0);
    return net > 0 ? (100 * circ) / net : 0;
  };
  const balance = (r) => {
    const net = Number(r.net_weight_kg || 0);
    const circ = Number(r.circle_weight_kg || 0);
    const scrap = Number(r.scrap_weight_kg || 0);
    return net - circ - scrap;
  };

const Head = ({ children, w, right, className = "" }) => (
  <th
    className={`whitespace-nowrap ${right ? "text-right" : "text-left"} ${className}`}
    style={{ width: w }}
  >
    {children}
  </th>
);

  const exportCSV = () => {
    const headers = [
      "Date",
      "Source Ref",
      "Operator",
      "Grade",
      "Thickness",  
      "Patta size",
      "Net weight",
      "Circle size",
      "Circle weight",
      "Pcs",
      "Scrap",
      "Balance",
      "Yield %",
    ];
    const lines = [headers.join(",")];
    rows.forEach((r) => {
      const y = yieldPct(r);
      const b = balance(r);
      const vals = [
        r.run_date || "",
        r.source_ref || "",
        r.operator || "",
        r.grade || "",
        r.thickness_mm ?? "",
        r.patta_size ?? "",
        r.net_weight_kg ?? "",
        r.op_size_mm ?? "",
        r.circle_weight_kg ?? "",
        r.qty ?? "",
        r.scrap_weight_kg ?? "",
        b,
        y.toFixed(2),
      ].map((x) => (x === null || x === undefined ? "" : String(x)));
      lines.push(vals.map(csvEscape).join(","));
    });
    downloadCSV("patta_runs.csv", lines.join("\n"));
  };
  const csvEscape = (v) => {
    if (v.includes(",") || v.includes('"') || v.includes("\n")) {
      return `"${v.replace(/"/g, '""')}"`;
    }
    return v;
  };
  const downloadCSV = (filename, content) => {
    const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredPattaOptions = availablePatta.filter((p) => {
    // Prevent double use of patta sources
    if (p.source_type === "patta") {
      return !usedPattaIds.has(p.source_id);
    }
    return true;
  });

  return (
    <div className="space-y-4">
      <Section
        title="Patta — Production Runs (Auto-Stock Update)"
        right={
  <div className="flex items-center gap-2">
    <button
      onClick={() => setShowAddForm(!showAddForm)}
      className="bg-green-600 text-white rounded-lg px-3 py-2"
    >
      {showAddForm ? "Cancel" : "Add Patta Run"}
    </button>

    <Input
      label="From"
      type="date"
      value={from}
      onChange={(e) => setFrom(e.target.value)}
    />
    <Input
      label="To"
      type="date"
      value={to}
      onChange={(e) => setTo(e.target.value)}
    />

    <label className="text-sm">
      <div className="text-slate-600 mb-1">Operator</div>
      <select
        value={operator}
        onChange={(e) => setOperator(e.target.value)}
        className="border rounded-lg px-3 py-2"
      >
        <option value="">All</option>
        {OPERATORS.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </label>

    <input
      value={q}
      onChange={(e) => setQ(e.target.value)}
      placeholder="Search..."
      className="border rounded-lg px-3 py-2 w-48"
    />

    {/* New: Excel export for Patta runs */}
    <ExportSheetButton tab="patta_runs" />

    <button
      onClick={exportCSV}
      className="bg-emerald-600 text-white rounded-lg px-3 py-2"
    >
      Export CSV
    </button>
  </div>
}
      >
        <div className="text-xs text-slate-600 mb-3 bg-blue-50 p-2 rounded">
          <b>Note:</b> Cut patta into circles. Circle production automatically updates stock. Use Stock & Sales tab to record actual sales.
        </div>

        {/* Add New Patta Run Form */}
        {showAddForm && (
          <form
            onSubmit={createPattaRun}
            className="bg-slate-50 rounded-lg p-4 mb-4 grid grid-cols-2 md:grid-cols-4 gap-3"
          >
            <h3 className="col-span-full font-semibold">Add New Patta Run</h3>

            <label className="text-sm">
              <div className="text-slate-600 mb-1">Select Patta Source</div>
              <select
                value={newRun.patta_source_id}
                onChange={(e) => {
                  const selected = filteredPattaOptions.find(
                    (p) =>
                      p.source_id == e.target.value &&
                      p.source_type == newRun.source_type
                  );
                  setNewRun({
                    ...newRun,
                    patta_source_id: e.target.value,
                    net_weight_kg: selected?.patta_weight_kg || "",
                    patta_size: selected?.patta_size || "",
                    // keep op_size_mm as the *circle size you will cut* (user may change)
                    op_size_mm: newRun.op_size_mm || "",
                    grade: selected?.grade || newRun.grade || ""
                  });
                }}
                className="border rounded-lg px-3 py-2"
                required
              >
                <option value="">Select...</option>
                {filteredPattaOptions.map((p, i) => (
                  <option key={i} value={p.source_id}>
                    {p.rn} - {p.patta_size} ({fmt(p.patta_weight_kg)}kg)
                  </option>
                ))}
              </select>
            </label>

            <Input
              label="Run Date"
              type="date"
              value={newRun.run_date}
              onChange={(e) => setNewRun({ ...newRun, run_date: e.target.value })}
            />

            <label className="text-sm">
              <div className="text-slate-600 mb-1">Operator</div>
              <select
                value={newRun.operator}
                onChange={(e) => setNewRun({ ...newRun, operator: e.target.value })}
                className="border rounded-lg px-3 py-2"
              >
                {OPERATORS.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </label>

{/* INSERT THIS RIGHT AFTER OPERATOR */}
<label className="text-sm">
  <div className="text-slate-600 mb-1">Grade</div>
  <select
    value={newRun.grade}
    onChange={(e) => setNewRun({ ...newRun, grade: e.target.value })}
    className="border rounded-lg px-3 py-2"
    required
  >
    <option value="">Select…</option>
    {GRADES.map((g) => (
      <option key={g} value={g}>{g}</option>
    ))}
  </select>
</label>

 <NumberInput
   label="Patta Size (mm)"
   value={newRun.patta_size}
   onChange={(e) => setNewRun({ ...newRun, patta_size: e.target.value })}
   readOnly
 />

            <NumberInput
              label="Net Weight (kg)"
              value={newRun.net_weight_kg}
              onChange={(e) => setNewRun({ ...newRun, net_weight_kg: e.target.value })}
            />

            <NumberInput
              label="Circle Size (mm)"
              value={newRun.op_size_mm}
              onChange={(e) => setNewRun({ ...newRun, op_size_mm: e.target.value })}
            />

            <NumberInput
              label="Circle Weight (kg)"
              value={newRun.circle_weight_kg}
              onChange={(e) => setNewRun({ ...newRun, circle_weight_kg: e.target.value })}
            />

            <NumberInput
              label="Circle Pcs"
              value={newRun.qty}
              onChange={(e) => setNewRun({ ...newRun, qty: e.target.value })}
            />

            <NumberInput
              label="Scrap Weight (kg)"
              value={newRun.scrap_weight_kg}
              onChange={(e) => setNewRun({ ...newRun, scrap_weight_kg: e.target.value })}
            />

            <div className="col-span-full">
              <button
                type="submit"
                className="bg-green-600 text-white rounded-lg px-4 py-2"
              >
                Create Patta Run
              </button>
            </div>
          </form>
        )}

        {/* Patta Runs Table */}
<StickyTable
  headers={[
    { label: "Date", className: "w-36" },
    { label: "Source Ref", className: "w-44" },
    { label: "Operator", className: "w-40" },
    { label: "Grade", className: "w-28" },
    { label: "Thickness (mm)", className: "text-right w-32" },
    { label: "Patta size", className: "text-right w-32" },
    { label: "Net weight", className: "text-right w-36" },
    { label: "Circle size", className: "text-right w-36 border-l border-slate-200" },
    { label: "Circle weight", className: "text-right w-40" },
    { label: "Pcs", className: "text-right w-28" },
    { label: "Scrap", className: "text-right w-36" },
    { label: "Balance", className: "text-right w-36" },
    { label: "Yield %", className: "text-right w-28" },
    { label: "", className: "w-36" },
  ]}
>
  {rows.map((r) => {
    const isEdit = editingId === r.id;
    const y = isEdit
      ? (() => {
          const net = Number(draft.net_weight_kg || 0);
          const circ = Number(draft.circle_weight_kg || 0);
          return net > 0 ? (100 * circ) / net : 0;
        })()
      : yieldPct(r);
    const b = isEdit
      ? (() => {
          const net = Number(draft.net_weight_kg || 0);
          const circ = Number(draft.circle_weight_kg || 0);
          const scrap = Number(draft.scrap_weight_kg || 0);
          return net - circ - scrap;
        })()
      : balance(r);

    return (
      <tr key={r.id} className="border-t">
        {/* Date */}
        <td>
          {isEdit ? (
            <input
              type="date"
              value={draft.run_date}
              onChange={(e) =>
                setDraft({ ...draft, run_date: e.target.value })
              }
              className="border rounded px-2 py-1 w-[130px]"
            />
          ) : (
            r.run_date || "—"
          )}
        </td>

        {/* Source Reference */}
        <td>{r.source_ref}</td>

        {/* Operator */}
        <td>
          {isEdit ? (
            <select
              value={draft.operator}
              onChange={(e) =>
                setDraft({ ...draft, operator: e.target.value })
              }
              className="border rounded px-2 py-1 w-[130px]"
            >
              <option value="">—</option>
              {OPERATORS.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          ) : (
            r.operator || "—"
          )}
        </td>

        {/* Grade */}
        <td>
          {isEdit ? (
            <select
              value={draft.grade}
              onChange={(e) => setDraft({ ...draft, grade: e.target.value })}
              className="border rounded px-2 py-1 w-[90px]"
            >
              <option value="">—</option>
              {GRADES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          ) : (
            r.grade || "—"
          )}
        </td>

        {/* Thickness (mm) */}
        <td className="text-right">
          {isEdit ? (
            <input
              value={draft.thickness_mm ?? ""}
              readOnly
              className="border rounded px-2 py-1 w-[90px] text-right bg-slate-100"
            />
          ) : (
            r.thickness_mm ?? "—"
          )}
        </td>

        {/* Patta size */}
        <td className="text-right">
          {isEdit ? (
            <input
              value={draft.patta_size ?? ""}
              readOnly
              className="border rounded px-2 py-1 w-[90px] text-right bg-slate-100"
            />
          ) : (
            r.patta_size ?? "—"
          )}
        </td>

        {/* Net weight */}
        <td className="text-right">
          {isEdit ? (
            <NumCell
              val={draft.net_weight_kg}
              on={(v) => setDraft({ ...draft, net_weight_kg: v })}
              w={110}
            />
          ) : (
            fmt(r.net_weight_kg)
          )}
        </td>

        {/* Circle size */}
        <td>
          {isEdit ? (
            <NumCell
              val={draft.op_size_mm}
              on={(v) => setDraft({ ...draft, op_size_mm: v })}
              w={80}
            />
          ) : (
            r.op_size_mm ?? "—"
          )}
        </td>

        {/* Circle weight */}
        <td className="text-right">
          {isEdit ? (
            <NumCell
              val={draft.circle_weight_kg}
              on={(v) => setDraft({ ...draft, circle_weight_kg: v })}
              w={110}
            />
          ) : (
            fmt(r.circle_weight_kg)
          )}
        </td>

        {/* Qty */}
        <td className="text-right">
          {isEdit ? (
            <NumCell
              val={draft.qty}
              on={(v) => setDraft({ ...draft, qty: v })}
              w={80}
            />
          ) : (
            fmt(r.qty)
          )}
        </td>

        {/* Scrap */}
        <td className="text-right">
          {isEdit ? (
            <NumCell
              val={draft.scrap_weight_kg}
              on={(v) => setDraft({ ...draft, scrap_weight_kg: v })}
              w={95}
            />
          ) : (
            fmt(r.scrap_weight_kg)
          )}
        </td>

        {/* Derived */}
        <td className="text-right font-medium">{fmt(b)}</td>
        <td className="text-right">{y.toFixed(2)}</td>

        {/* Actions */}
        <td>
          {isEdit ? (
            <div className="flex gap-1">
              <button
                className="px-2 py-1 rounded bg-emerald-600 text-white"
                onClick={() => saveEdit(r.id)}
              >
                Save
              </button>
              <button
                className="px-2 py-1 rounded border"
                onClick={cancelEdit}
                type="button"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex gap-1">
              <button
                className="px-2 py-1 rounded border"
                onClick={() => startEdit(r)}
              >
                Edit
              </button>
              <button
                className="px-2 py-1 text-red-600 border border-red-300 rounded hover:bg-red-50"
                onClick={() => deleteRun(r.id)}
              >
                Del
              </button>
            </div>
          )}
        </td>
      </tr>
    );
  })}
  {!rows.length && (
    <tr>
      <td className="py-4 text-slate-500 text-center" colSpan={14}>
        No patta runs found.
      </td>
    </tr>
  )}
</StickyTable>
      </Section>
    </div>
  );
}

/* ================================= SCRAP ================================== */
function ScrapTab() {
  const [rows, setRows] = useState([]);
  const [totals, setTotals] = useState({ total_kg: 0, sold_kg: 0, available_kg: 0 });
  const [sales, setSales] = useState([]);

  // === Global Scrap Sale form state/handler ===
  const [scrapSaleDate, setScrapSaleDate] = useState(new Date().toISOString().slice(0, 10));
  const [scrapBuyer, setScrapBuyer] = useState("");
  const [scrapGrade, setScrapGrade] = useState("");
  const [scrapWeight, setScrapWeight] = useState("");
  const [scrapPrice, setScrapPrice] = useState("");
  const [scrapSaving, setScrapSaving] = useState(false);

  const today = () => new Date().toISOString().slice(0, 10);
  const getRemaining = (r) =>
    Number(r?.remaining ?? r?.remaining_kg ?? r?.available_kg ?? 0);

  const loadScrap = async () => {
    const res = await axios.get(`${API}/scrap`);
    setRows(res.data?.rows ?? []);
    setTotals(res.data?.totals ?? { total_kg: 0, sold_kg: 0, available_kg: 0 });
  };

  const loadSales = async () => {
    const res = await axios.get(`${API}/scrap-sales`);
    setSales(res.data ?? []);
  };

  const reloadAll = async () => {
    await Promise.all([loadScrap(), loadSales()]);
  };

  useEffect(() => {
    reloadAll();
  }, []);

  // === Global Scrap Sale Submit ===
  async function submitGlobalScrapSale(e) {
    e.preventDefault();
    const weight_kg = Number(scrapWeight || 0);
    if (!weight_kg || weight_kg <= 0) {
      alert("Enter a valid scrap weight (> 0).");
      return;
    }
    try {
      setScrapSaving(true);
      const res = await axios.post(`${API}/scrap-sales/record-bulk`, {
        sale_date: scrapSaleDate,
        buyer: scrapBuyer || null,
        grade: scrapGrade || null,
        weight_kg,
        price_per_kg: scrapPrice === "" ? null : Number(scrapPrice),
      });

      if (res.data?.allocations?.length) {
        alert(
          "Allocated:\n" +
            res.data.allocations
              .map((a) => `${a.weight_kg} kg from ${a.source_type} (RN=${a.rn})`)
              .join("\n")
        );
      }

      setScrapBuyer("");
      setScrapGrade("");
      setScrapWeight("");
      setScrapPrice("");
      await reloadAll();
    } catch (err) {
      console.error("Failed to record scrap sale", err);
      alert(err?.response?.data?.error || "Failed to record scrap sale");
    } finally {
      setScrapSaving(false);
    }
  }

  const undoScrapSale = async (id) => {
    if (!confirm("Undo this scrap sale?")) return;
    try {
      await axios.delete(`${API}/scrap-sales/${id}`);
      await reloadAll();
    } catch (err) {
      console.error("Failed to undo scrap sale", err);
      alert("Error undoing scrap sale. Check console for details.");
    }
  };

  const visibleRows = (rows ?? []).filter((r) => getRemaining(r) > 0);

  return (
    <Section
      title="Scrap (auto from Circle & Patta)"
      right={<ExportSheetButton tab="scrap_sales" />}
    >
      {/* Global scrap sale form */}
      <form
        onSubmit={submitGlobalScrapSale}
        className="mb-3 flex flex-wrap items-end gap-2"
      >
        <label className="text-sm">
          <div className="text-slate-600 mb-1">Sale Date</div>
          <input
            type="date"
            className="border rounded px-3 py-2"
            value={scrapSaleDate}
            onChange={(e) => setScrapSaleDate(e.target.value)}
          />
        </label>

        <label className="text-sm">
          <div className="text-slate-600 mb-1">Buyer</div>
          <input
            className="border rounded px-3 py-2 w-56"
            value={scrapBuyer}
            onChange={(e) => setScrapBuyer(e.target.value)}
            placeholder="Buyer (optional)"
          />
        </label>

        <label className="text-sm">
          <div className="text-slate-600 mb-1">Grade</div>
          <input
            className="border rounded px-3 py-2 w-32"
            value={scrapGrade}
            onChange={(e) => setScrapGrade(e.target.value)}
            placeholder="e.g. 304"
          />
        </label>

        <label className="text-sm">
          <div className="text-slate-600 mb-1">Weight (kg)</div>
          <input
            type="number"
            step="0.01"
            className="border rounded px-3 py-2 w-32 text-right"
            value={scrapWeight}
            onChange={(e) => setScrapWeight(e.target.value)}
            required
          />
        </label>

        <label className="text-sm">
          <div className="text-slate-600 mb-1">Price/kg</div>
          <input
            type="number"
            step="0.01"
            className="border rounded px-3 py-2 w-28 text-right"
            value={scrapPrice}
            onChange={(e) => setScrapPrice(e.target.value)}
            placeholder="optional"
          />
        </label>

        <button
          type="submit"
          className="bg-emerald-600 text-white rounded px-4 py-2 disabled:opacity-60"
          disabled={scrapSaving}
        >
          {scrapSaving ? "Saving…" : "Record Sale"}
        </button>
      </form>

      {/* Scrap stock table */}
      <StickyTable
        headers={[
          { label: "Date", className: "w-32" },
          { label: "Source RN", className: "w-32" },
          { label: "Source Type", className: "w-32" },
          { label: "Grade", className: "w-28" },
          { label: "Remaining (kg)", className: "text-right w-40" },
        ]}
      >
        {visibleRows.map((r, i) => {
          const key = r.id ?? `${r.rn ?? "rn"}-${i}`;
          const rem = getRemaining(r);
          return (
            <tr key={key} className="border-t">
              <td>{r.date ?? "—"}</td>
              <td>{r.rn ?? "—"}</td>
              <td className="capitalize">{r.source_type ?? "—"}</td>
              <td>{r.grade ?? "—"}</td>
              <td className="text-right">{fmt(rem)}</td>
            </tr>
          );
        })}

        {!visibleRows.length && (
          <tr>
            <td className="py-4 text-slate-500 text-center" colSpan={5}>
              All cleared 🎉 (no scrap with balance &gt; 0)
            </td>
          </tr>
        )}

        {/* Totals */}
        <tr className="border-t bg-yellow-50 font-semibold">
          <td colSpan={4} className="text-right px-2 py-2">
            Total Scrap (kg)
          </td>
          <td className="text-right px-2 py-2">{fmt(totals.total_kg ?? 0)}</td>
        </tr>
        <tr className="border-t bg-yellow-50">
          <td colSpan={4} className="text-right px-2 py-2">
            Scrap Sold (kg)
          </td>
          <td className="text-right px-2 py-2">{fmt(totals.sold_kg ?? 0)}</td>
        </tr>
        <tr className="border-t bg-emerald-50">
          <td colSpan={4} className="text-right px-2 py-2 font-semibold">
            Available Scrap (kg)
          </td>
          <td className="text-right px-2 py-2 font-semibold">
            {fmt(totals.available_kg ?? 0)}
          </td>
        </tr>
      </StickyTable>

      {/* Scrap Sales History */}
      <div className="mt-6">
        <h3 className="font-semibold mb-2">Recent Scrap Sales</h3>
        <StickyTable
          headers={[
            { label: "Sale Date", className: "w-32" },
            { label: "Buyer", className: "w-40" },
            { label: "Grade", className: "w-28" },
            { label: "RN", className: "w-32" },
            { label: "Weight (kg)", className: "text-right w-40" },
            { label: "Price/kg", className: "text-right w-32" },
            { label: "Total Value", className: "text-right w-40" },
            { label: "", className: "w-20" },
          ]}
        >
          {sales.map((s) => (
            <tr key={s.id} className="border-t">
              <td>{s.sale_date ?? "—"}</td>
              <td>{s.buyer ?? "—"}</td>
              <td>{s.grade ?? "—"}</td>
              <td>{s.rn ?? "—"}</td>
              <td className="text-right">{fmt(Number(s.weight_kg ?? 0))}</td>
              <td className="text-right">
                {s.price_per_kg != null ? fmt(Number(s.price_per_kg)) : "—"}
              </td>
              <td className="text-right">
                {s.price_per_kg != null
                  ? fmt(Number(s.price_per_kg) * Number(s.weight_kg ?? 0))
                  : "—"}
              </td>
              <td className="flex gap-2">
                <button
                  onClick={() => undoScrapSale(s.id)}
                  className="px-2 py-1 text-red-600 border border-red-300 rounded hover:bg-red-50"
                >
                  Undo
                </button>
              </td>
            </tr>
          ))}
          {!sales.length && (
            <tr>
              <td className="py-4 text-slate-500 text-center" colSpan={8}>
                No scrap sales recorded.
              </td>
            </tr>
          )}
        </StickyTable>
      </div>
    </Section>
  );
}

/* ================================ YIELD ================================== */
function YieldTab() {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");

  const load = async () => {
    try {
      const res = await axios.get(`${API}/yield`, { params: { q: q || undefined } });
      setRows(res.data || []);
    } catch {
      setRows([]);
    }
  };
  useEffect(() => { load(); }, [q]);

  const exportCSV = () => {
    const headers = [
      "Coil RN",
      "Grade",
      "Net Weight (kg)",
      "Circle Yield %",
      "Patta Yield %",
      "Total Yield %",
    ];
    const lines = [headers.join(",")];
    rows.forEach(r => {
      const vals = [
        r.rn || "",
        r.grade || "",
        r.net_weight_kg ?? "",
        (Number(r.circle_yield_pct || 0)).toFixed(2),
        (Number(r.patta_yield_pct  || 0)).toFixed(2),
        (Number(r.total_yield_pct  || 0)).toFixed(2),
      ].map(v => (v === null || v === undefined ? "" : String(v)));
      // csv escape
      lines.push(vals.map(v => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(","));
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "yield.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const Head = ({ children, right, w }) => (
    <th className={`whitespace-nowrap ${right ? "text-right" : "text-left"}`} style={{ width: w }}>
      {children}
    </th>
  );

  return (
<Section
  title="Yield (per coil)"
  right={
    <div className="flex items-center gap-2">
      <ExportSheetButton tab="yield" />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search RN / Grade…"
        className="border rounded-lg px-3 py-2 w-56"
      />
      <button onClick={exportCSV} className="bg-emerald-600 text-white rounded-lg px-3 py-2">
        Export CSV
      </button>
    </div>
  }
>
      <StickyTable
  headers={[
    { label: "Coil RN", className: "w-40" },
    { label: "Grade", className: "w-28" },
    { label: "Net Weight (kg)", className: "text-right w-40" },
    { label: "Circle Yield %", className: "text-right w-36" },
    { label: "Patta Yield %", className: "text-right w-36" },
    { label: "Total Yield %", className: "text-right w-36" },
  ]}
>
  {rows.map((r, i) => (
    <tr key={r.id ?? r.rn ?? i} className="border-t">
      <td>{r.rn || "—"}</td>
      <td>{r.grade || "—"}</td>
      <td className="text-right">{fmt(r.net_weight_kg)}</td>
      <td className="text-right">{Number(r.circle_yield_pct || 0).toFixed(2)}</td>
      <td className="text-right">{Number(r.patta_yield_pct || 0).toFixed(2)}</td>
      <td className="text-right font-semibold">
        {Number(r.total_yield_pct || 0).toFixed(2)}
      </td>
    </tr>
  ))}
  {!rows.length && (
    <tr>
      <td className="py-4 text-slate-500 text-center" colSpan={6}>
        No data.
      </td>
    </tr>
  )}
</StickyTable>
    </Section>
  );
}

/* ============================= STOCK & SALES ============================= */
function StockSalesTab() {
  const [coilStock, setCoilStock] = useState([]);
  const [circleStock, setCircleStock] = useState([]);
  const [q, setQ] = useState("");

  // coil sales
  const [showCoilSaleForm, setShowCoilSaleForm] = useState(false);
  const [coilSaleForm, setCoilSaleForm] = useState({
    coil_id: "",
    sold_weight_kg: "",
    buyer: "",
    price_per_kg: "",
    sale_date: "",
  });

  // circle sales (unchanged logic)
  const [sales, setSales] = useState([]);
  const [showSaleForm, setShowSaleForm] = useState(false);
  const [saleForm, setSaleForm] = useState({
    stock_id: "",
    sold_qty: "",
    sold_weight_kg: "",
    buyer: "",
    price_per_kg: "",
    sale_date: "",
  });

  // scrap sales
  const [scrapSales, setScrapSales] = useState([]);
  const [showScrapForm, setShowScrapForm] = useState(false);
const [scrapForm, setScrapForm] = useState({
  sale_date: "",
  buyer: "",
  weight_kg: "",
  price_per_kg: "",
  grade: "",          // <-- NEW
  notes: "",
});
  const [scrapTotals, setScrapTotals] = useState({
    total_kg: 0,
    sold_kg: 0,
    available_kg: 0,
  });

  // coil sales history
  const [coilSales, setCoilSales] = useState([]);

  const loadCoilStock = async () => {
    try {
      const res = await axios.get(`${API}/coil-stock`, { params: { q } });
      setCoilStock(res.data || []);
    } catch (error) {
      console.error("Failed to load coil stock:", error);
    }
  };
  const loadCircleStock = async () => {
    const res = await axios.get(`${API}/circle-stock`, { params: { q } });
    setCircleStock(res.data || []);
  };
  const loadSales = async () => {
    const res = await axios.get(`${API}/circle-sales`);
    setSales(res.data || []);
  };
  const loadCoilSales = async () => {
    const res = await axios.get(`${API}/coil-direct-sales`); // New endpoint for coil sales history
    setCoilSales(res.data || []);
  };
  const loadScrapSales = async () => {
    const res = await axios.get(`${API}/scrap-sales`);
    setScrapSales(res.data || []);
  };
  const loadScrapTotals = async () => {
    const res = await axios.get(`${API}/scrap`);
    setScrapTotals(res.data?.totals || { total_kg: 0, sold_kg: 0, available_kg: 0 });
  };

  useEffect(() => {
    loadCoilStock();
    loadCircleStock();
    loadSales();
    loadCoilSales(); // Load coil sales history
    loadScrapSales();
    loadScrapTotals();
  }, [q]);

  const recordCoilSale = async (e) => {
    e.preventDefault();
    const payload = {
      sold_weight_kg: Number(coilSaleForm.sold_weight_kg || 0),
      buyer: coilSaleForm.buyer || null,
      price_per_kg: coilSaleForm.price_per_kg ? Number(coilSaleForm.price_per_kg) : null,
      sale_date: coilSaleForm.sale_date || undefined,
    };

    if (!coilSaleForm.coil_id || payload.sold_weight_kg <= 0) {
      return alert("Please select a coil and enter a valid sold weight.");
    }

    try {
      await axios.post(`${API}/coils/${coilSaleForm.coil_id}/sell-direct`, payload);
      setCoilSaleForm({
        coil_id: "",
        sold_weight_kg: "",
        buyer: "",
        price_per_kg: "",
        sale_date: "",
      });
      setShowCoilSaleForm(false);
      loadCoilStock();
      loadCoilSales();
    } catch (error) {
      console.error("Failed to record coil sale:", error);
      alert("Failed to record coil sale. Check console for details.");
    }
  };

  const createSale = async (e) => {
    e.preventDefault();
    const payload = {
      stock_id: Number(saleForm.stock_id),
      sold_qty: Number(saleForm.sold_qty),
      sold_weight_kg: Number(saleForm.sold_weight_kg),
      buyer: saleForm.buyer || null,
      price_per_kg: saleForm.price_per_kg ? Number(saleForm.price_per_kg) : null,
      sale_date: saleForm.sale_date || undefined,
    };

    if (!payload.stock_id || !payload.sold_qty || !payload.sold_weight_kg) {
      return alert("Stock, quantity and weight are required");
    }

    await axios.post(`${API}/circle-sales`, payload);
    setSaleForm({
      stock_id: "",
      sold_qty: "",
      sold_weight_kg: "",
      buyer: "",
      price_per_kg: "",
      sale_date: "",
    });
    setShowSaleForm(false);
    loadCircleStock();
    loadSales();
  };

  const deleteSale = async (id) => {
    if (!confirm("Undo this sale?")) return;
    try {
      await axios.delete(`${API}/circle-sales/${id}`);
      loadCircleStock();
      loadSales();
    } catch {
      alert("Error undoing sale");
    }
  };

  const recordScrapSale = async (e) => {
    e.preventDefault();
    const payload = {
  sale_date: scrapForm.sale_date || undefined,
  buyer: scrapForm.buyer || null,
  weight_kg: Number(scrapForm.weight_kg || 0),
  price_per_kg: scrapForm.price_per_kg
    ? Number(scrapForm.price_per_kg)
    : null,
  grade: scrapForm.grade || null,   // <-- NEW
  notes: scrapForm.notes || null,
};
    if (!payload.weight_kg || payload.weight_kg <= 0)
      return alert("Weight must be > 0");
    await axios.post(`${API}/scrap-sales/record-bulk`, payload);
    setScrapForm({
  sale_date: "",
  buyer: "",
  weight_kg: "",
  price_per_kg: "",
  grade: "",      // <-- NEW
  notes: "",
});
    setShowScrapForm(false);
    loadScrapSales();
    loadScrapTotals();
  };
  const deleteScrapSale = async (id) => {
    if (!confirm("Undo this scrap sale?")) return;
    try {
      await axios.delete(`${API}/scrap-sales/${id}`);
      loadScrapSales();
      loadScrapTotals();
    } catch {
      alert("Error undoing scrap sale");
    }
  };

  const deleteCoilSale = async (id) => {
    if (!confirm("Undo this coil sale?")) return;
    try {
      await axios.delete(`${API}/coil-direct-sales/${id}`);
      loadCoilStock(); // Reload coil stock to reflect returned weight
      loadCoilSales(); // Reload coil sales history
    } catch {
      alert("Error undoing coil sale");
    }
  };

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="flex items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search RN / Grade / Supplier..."
          className="border rounded-lg px-3 py-2 w-64"
        />
      </div>

      {/* COIL STOCK (separate) */}
      <Section title="Coil Stock"
        right={
          <button
            onClick={() => setShowCoilSaleForm(!showCoilSaleForm)}
            className="bg-green-600 text-white rounded-lg px-3 py-2"
          >
            {showCoilSaleForm ? "Cancel Sale" : "Record Coil Sale"}
          </button>
        }
      >
        {/* Coil Sale Form */}
        {showCoilSaleForm && (
          <form
            onSubmit={recordCoilSale}
            className="bg-slate-50 rounded-lg p-4 mb-4 grid grid-cols-2 md:grid-cols-3 gap-3"
          >
            <h3 className="col-span-full font-semibold">Record New Coil Sale</h3>

            <label className="text-sm">
              <div className="text-slate-600 mb-1">Select Coil</div>
              <select
                value={coilSaleForm.coil_id}
                onChange={(e) => {
                  const selected = coilStock.find((s) => s.coil_id == e.target.value);
                  setCoilSaleForm({
                    ...coilSaleForm,
                    coil_id: e.target.value,
                    sold_weight_kg: selected?.available_weight_kg || "",
                  });
                }}
                className="border rounded-lg px-3 py-2"
                required
              >
                <option value="">Select...</option>
                {coilStock
                  .filter((s) => s.available_weight_kg > 0)
                  .map((s) => (
                    <option key={s.id} value={s.coil_id}>
                      {s.rn} - {s.grade || "—"} - {fmt(s.available_weight_kg)}kg
                    </option>
                  ))}
              </select>
            </label>

            <NumberInput
              label="Sold Weight (kg)"
              value={coilSaleForm.sold_weight_kg}
              onChange={(e) =>
                setCoilSaleForm({ ...coilSaleForm, sold_weight_kg: e.target.value })
              }
              required
            />

            <Input
              label="Buyer"
              value={coilSaleForm.buyer}
              onChange={(e) =>
                setCoilSaleForm({ ...coilSaleForm, buyer: e.target.value })
              }
            />

            <NumberInput
              label="Price per kg"
              value={coilSaleForm.price_per_kg}
              onChange={(e) =>
                setCoilSaleForm({ ...coilSaleForm, price_per_kg: e.target.value })
              }
            />

            <Input
              label="Sale Date"
              type="date"
              value={coilSaleForm.sale_date}
              onChange={(e) =>
                setCoilSaleForm({ ...coilSaleForm, sale_date: e.target.value })
              }
            />

            <div className="col-span-full">
              <button
                type="submit"
                className="bg-green-600 text-white rounded-lg px-4 py-2"
              >
                Record Sale
              </button>
            </div>
          </form>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-600">
              <tr>
                <th>RN</th>
                <th>Grade</th>
                <th>Spec</th>
                <th>Supplier</th>
                <th>Purchase Date</th>
                <th className="text-right">Available Weight (kg)</th>
              </tr>
            </thead>
            <tbody className="[&>tr:nth-child(odd)]:bg-slate-50">
              {coilStock.map((s) => (
                <tr key={s.id} className="border-t">
                  <td>{s.rn}</td>
                  <td>{s.grade || "—"}</td>
                  <td>
                    {[
                      s.thickness ? `${s.thickness}mm` : null,
                      s.width ? `${s.width}mm` : null,
                    ]
                      .filter(Boolean)
                      .join(" × ") || "—"}
                  </td>
                  <td>{s.supplier || "—"}</td>
                  <td>{s.purchase_date || "—"}</td>
                  <td className="text-right font-semibold">
                    {fmt(s.available_weight_kg)}
                  </td>
                </tr>
              ))}
              {!coilStock.length && (
                <tr>
                  <td className="py-4 text-slate-500" colSpan={6}>
                    No coil stock available.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      {/* COIL SALES HISTORY */}
      <Section title="Coil Sales History">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-600">
              <tr>
                <th>Sale Date</th>
                <th>Coil RN</th>
                <th>Buyer</th>
                <th className="text-right">Weight Sold (kg)</th>
                <th className="text-right">Price/kg</th>
                <th className="text-right">Total Value</th>
                <th></th>
              </tr>
            </thead>
            <tbody className="[&>tr:nth-child(odd)]:bg-slate-50">
              {coilSales.map((s) => (
                <tr key={s.id} className="border-t">
                  <td>{s.sale_date || "—"}</td>
                  <td>{s.rn || "—"}</td>
                  <td>{s.buyer || "—"}</td>
                  <td className="text-right">{fmt(s.sold_weight_kg)}</td>
                  <td className="text-right">
                    {s.price_per_kg != null ? fmt(s.price_per_kg) : "—"}
                  </td>
                  <td className="text-right">
                    {s.price_per_kg != null
                      ? fmt(s.price_per_kg * s.sold_weight_kg)
                      : "—"}
                  </td>
                  <td>
                    <button
                      onClick={() => deleteCoilSale(s.id)}
                      className="px-2 py-1 text-red-600 border border-red-300 rounded hover:bg-red-50"
                    >
                      Undo
                    </button>
                  </td>
                </tr>
              ))}
              {!coilSales.length && (
                <tr>
                  <td className="py-4 text-slate-500" colSpan={7}>
                    No coil sales recorded.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>

      {/* CIRCLE STOCK (separate, trimmed columns) */}
      <Section
        title="Circle Stock"
        right={
          <button
            onClick={() => setShowSaleForm(!showSaleForm)}
            className="bg-green-600 text-white rounded-lg px-3 py-2"
          >
            {showSaleForm ? "Cancel Sale" : "Record Circle Sale"}
          </button>
        }
      >
        {/* Sale form (for circle stock items only) */}
        {showSaleForm && (
          <form
            onSubmit={createSale}
            className="bg-slate-50 rounded-lg p-4 mb-4 grid grid-cols-2 md:grid-cols-3 gap-3"
          >
            <h3 className="col-span-full font-semibold">Record New Circle Sale</h3>

            <label className="text-sm">
              <div className="text-slate-600 mb-1">Select Circle Stock</div>
              <select
                value={saleForm.stock_id}
                onChange={(e) => {
                  const selected = circleStock.find((s) => s.id == e.target.value);
                  setSaleForm({
                    ...saleForm,
                    stock_id: e.target.value,
                    sold_qty: selected?.available_qty || "",
                    sold_weight_kg: selected?.available_weight_kg || "",
                  });
                }}
                className="border rounded-lg px-3 py-2"
                required
              >
                <option value="">Select...</option>
                {circleStock
                  .filter((s) => s.available_qty > 0)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.source_ref} - {s.grade || "—"} - {s.size_mm ?? "—"}mm (
                      {fmt(s.available_qty)} pcs, {fmt(s.available_weight_kg)}kg)
                    </option>
                  ))}
              </select>
            </label>

            <NumberInput
              label="Sold Qty"
              value={saleForm.sold_qty}
              onChange={(e) =>
                setSaleForm({ ...saleForm, sold_qty: e.target.value })
              }
              required
            />

            <NumberInput
              label="Sold Weight (kg)"
              value={saleForm.sold_weight_kg}
              onChange={(e) =>
                setSaleForm({ ...saleForm, sold_weight_kg: e.target.value })
              }
              required
            />

            <Input
              label="Buyer"
              value={saleForm.buyer}
              onChange={(e) => setSaleForm({ ...saleForm, buyer: e.target.value })}
            />

            <NumberInput
              label="Price per kg"
              value={saleForm.price_per_kg}
              onChange={(e) =>
                setSaleForm({ ...saleForm, price_per_kg: e.target.value })
              }
            />

            <Input
              label="Sale Date"
              type="date"
              value={saleForm.sale_date}
              onChange={(e) =>
                setSaleForm({ ...saleForm, sale_date: e.target.value })
              }
            />

            <div className="col-span-full">
              <button
                type="submit"
                className="bg-green-600 text-white rounded-lg px-4 py-2"
              >
                Record Sale
              </button>
            </div>
          </form>
        )}

       {/* Circle Stock table (trimmed columns) */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-600">
              <tr>
                <th>Production Date</th>
                <th>Source</th>
                <th>Grade</th>
                <th>Size (mm)</th>
                <th className="text-right">Available Qty</th>
                <th className="text-right">Available Weight (kg)</th>
              </tr>
            </thead>
            <tbody className="[&>tr:nth-child(odd)]:bg-slate-50">
              {circleStock.map((s) => (
                <tr key={s.id} className="border-t">
                  <td>{s.production_date}</td>
                  <td>{s.source_ref}</td>
                  <td>{s.grade || "—"}</td>
                  <td>{s.size_mm ?? "—"}</td>
                  <td className="text-right font-semibold">
                    {fmt(s.available_qty)}
                  </td>
                  <td className="text-right font-semibold">
                    {fmt(s.available_weight_kg)}
                  </td>
                </tr>
              ))}
              {!circleStock.length && (
                <tr>
                  <td className="py-4 text-slate-500" colSpan={6}>
                    No circle stock available.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Circle Sales history (Undo supported via delete) */}
        <div className="mt-6">
          <h3 className="font-semibold mb-2">Circle Sales</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-slate-600">
                <tr>
                  <th>Sale Date</th>
                  <th>Source</th>
                  <th>Size (mm)</th>
                  <th>Buyer</th>
                  <th className="text-right">Qty Sold</th>
                  <th className="text-right">Weight Sold (kg)</th>
                  <th className="text-right">Price/kg</th>
                  <th className="text-right">Total Value</th>
                  <th></th>
                </tr>
              </thead>
              <tbody className="[&>tr:nth-child(odd)]:bg-slate-50">
                {sales.map((s) => (
                  <tr key={s.id} className="border-t">
                    <td>{s.sale_date}</td>
                    <td>{s.source_ref}</td>
                    <td>{s.size_mm ?? "—"}</td>
                    <td>{s.buyer || "—"}</td>
                    <td className="text-right">{fmt(s.sold_qty)}</td>
                    <td className="text-right">{fmt(s.sold_weight_kg)}</td>
                    <td className="text-right">
                      {s.price_per_kg ? fmt(s.price_per_kg) : "—"}
                    </td>
                    <td className="text-right">
                      {s.price_per_kg
                        ? fmt(s.sold_weight_kg * s.price_per_kg)
                        : "—"}
                    </td>
                    <td>
                      <button
                        onClick={() => deleteSale(s.id)}
                        className="px-2 py-1 text-red-600 border border-red-300 rounded hover:bg-red-50"
                      >
                        Undo
                      </button>
                    </td>
                  </tr>
                ))}
                {!sales.length && (
                  <tr>
                    <td className="py-4 text-slate-500" colSpan={9}>
                      No circle sales recorded.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </Section>

      {/* SCRAP SALES */}
      <Section
        title="Scrap Sales"
        right={
          <div className="text-sm text-slate-700">
            Available Scrap:&nbsp;
            <span className="font-semibold">{fmt(scrapTotals.available_kg)} kg</span>
          </div>
        }
      >
        <div className="mb-3">
          <button
            onClick={() => setShowScrapForm(!showScrapForm)}
            className="bg-green-600 text-white rounded-lg px-3 py-2"
          >
            {showScrapForm ? "Cancel" : "Record Scrap Sale"}
          </button>
        </div>

        {showScrapForm && (
          <form
            onSubmit={recordScrapSale}
            className="bg-slate-50 rounded-lg p-4 mb-4 grid grid-cols-2 md:grid-cols-4 gap-3"
          >
            <Input
              label="Sale Date"
              type="date"
              value={scrapForm.sale_date}
              onChange={(e) =>
                setScrapForm({ ...scrapForm, sale_date: e.target.value })
              }
            />
            <Input
              label="Buyer"
              value={scrapForm.buyer}
              onChange={(e) =>
                setScrapForm({ ...scrapForm, buyer: e.target.value })
              }
            />
<label className="text-sm">
  <div className="text-slate-600 mb-1">Grade</div>
  <select
    value={scrapForm.grade}
    onChange={(e) => setScrapForm({ ...scrapForm, grade: e.target.value })}
    className="border rounded-lg px-3 py-2 w-full"
    required
  >
    <option value="">Select grade</option>
    {GRADES.map((g) => (
      <option key={g} value={g}>{g}</option>
    ))}
  </select>
</label>

            <NumberInput
              label="Weight (kg)"
              required
              value={scrapForm.weight_kg}
              onChange={(e) =>
                setScrapForm({ ...scrapForm, weight_kg: e.target.value })
              }
            />
            <NumberInput
              label="Price/kg"
              value={scrapForm.price_per_kg}
              onChange={(e) =>
                setScrapForm({ ...scrapForm, price_per_kg: e.target.value })
              }
            />
            <Input
              label="Notes"
              value={scrapForm.notes}
              onChange={(e) =>
                setScrapForm({ ...scrapForm, notes: e.target.value })
              }
              className="md:col-span-4"
            />
            <div className="md:col-span-4">
              <button
                type="submit"
                className="bg-green-600 text-white rounded-lg px-4 py-2"
              >
                Save Scrap Sale
              </button>
            </div>
          </form>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-600">
  <tr>
    <th>Sale Date</th>
    <th>Buyer</th>
    <th>Grade</th>  {/* NEW */}
    <th className="text-right">Weight (kg)</th>
    <th className="text-right">Price/kg</th>
    <th className="text-right">Total Value</th>
    <th>Notes</th>
    <th></th>
  </tr>
</thead>
            <tbody className="[&>tr:nth-child(odd)]:bg-slate-50">
              {scrapSales.map((s) => (
                <tr key={s.id} className="border-t">
  <td>{s.sale_date}</td>
  <td>{s.buyer || "—"}</td>
  <td>{s.grade || "—"}</td> {/* NEW */}
  <td className="text-right">{fmt(s.weight_kg)}</td>
  <td className="text-right">
    {s.price_per_kg != null ? fmt(s.price_per_kg) : "—"}
  </td>
  <td className="text-right">
    {s.price_per_kg != null
      ? fmt(s.price_per_kg * s.weight_kg)
      : "—"}
  </td>
  <td>{s.notes || "—"}</td>
  <td>
    <button
      onClick={() => deleteScrapSale(s.id)}
      className="px-2 py-1 text-red-600 border border-red-300 rounded hover:bg-red-50"
    >
      Undo
    </button>
  </td>
</tr>
              ))}
              {!scrapSales.length && (
                <tr>
                  <td className="py-4 text-slate-500" colSpan={7}>
                    No scrap sales recorded.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

/* ================================= PL STOCK ================================= */
function PLStockTab() {
  const [rows, setRows] = useState([]);
  const [plSaleDate, setPlSaleDate] = useState(new Date().toISOString().slice(0,10));
  const [plBuyer, setPlBuyer] = useState("");
  const [plGrade, setPlGrade] = useState("");
  const [plWeight, setPlWeight] = useState("");
  const [plPrice, setPlPrice] = useState("");
  const [plSaving, setPlSaving] = useState(false);

  const load = async () => {
    const res = await axios.get(`${API}/pl-stock`);
    const all = res.data || [];
    const filtered = all.filter(
      (r) => Number(r.available_weight_kg ?? r.available_kg ?? 0) > 0
    );
    setRows(filtered);
  };

  useEffect(() => { load(); }, []);

  // === Global PL Sale Submit ===
  async function submitGlobalPLSale(e) {
    e.preventDefault();
    const weight_kg = Number(plWeight || 0);
    if (!weight_kg || weight_kg <= 0) {
      alert("Enter a valid PL weight (> 0).");
      return;
    }
    try {
      setPlSaving(true);
      const res = await axios.post(`${API}/pl-sales/record-bulk`, {
        sale_date: plSaleDate,
        buyer: plBuyer || null,
        grade: plGrade || null,
        weight_kg,
        price_per_kg: plPrice === "" ? null : Number(plPrice),
      });

      if (res.data?.allocations?.length) {
        alert("Allocated:\n" + res.data.allocations.map(a =>
          `${a.weight_kg} kg from PL Stock ID=${a.pl_stock_id}`
        ).join("\n"));
      }

      setPlBuyer(""); setPlGrade(""); setPlWeight(""); setPlPrice("");
      await load();
    } catch (err) {
      console.error("Failed to record PL sale", err);
      alert(err?.response?.data?.error || "Failed to record PL sale");
    } finally {
      setPlSaving(false);
    }
  }

  return (
    <Section title="PL Stock" right={<ExportSheetButton tab="pl_stock" />} >
      {/* Global PL sale form */}
      <form onSubmit={submitGlobalPLSale} className="mb-3 flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <div className="text-slate-600 mb-1">Sale Date</div>
          <input
            type="date"
            className="border rounded px-3 py-2"
            value={plSaleDate}
            onChange={(e) => setPlSaleDate(e.target.value)}
          />
        </label>

        <label className="text-sm">
          <div className="text-slate-600 mb-1">Buyer</div>
          <input
            className="border rounded px-3 py-2 w-56"
            value={plBuyer}
            onChange={(e) => setPlBuyer(e.target.value)}
            placeholder="Buyer (optional)"
          />
        </label>

        <label className="text-sm">
          <div className="text-slate-600 mb-1">Grade</div>
          <input
            className="border rounded px-3 py-2 w-32"
            value={plGrade}
            onChange={(e) => setPlGrade(e.target.value)}
            placeholder="e.g. 304"
          />
        </label>

        <label className="text-sm">
          <div className="text-slate-600 mb-1">Weight (kg)</div>
          <input
            type="number"
            step="0.01"
            className="border rounded px-3 py-2 w-32 text-right"
            value={plWeight}
            onChange={(e) => setPlWeight(e.target.value)}
            required
          />
        </label>

        <label className="text-sm">
          <div className="text-slate-600 mb-1">Price/kg</div>
          <input
            type="number"
            step="0.01"
            className="border rounded px-3 py-2 w-28 text-right"
            value={plPrice}
            onChange={(e) => setPlPrice(e.target.value)}
            placeholder="optional"
          />
        </label>

        <button
          type="submit"
          className="bg-emerald-600 text-white rounded px-4 py-2 disabled:opacity-60"
          disabled={plSaving}
        >
          {plSaving ? "Saving…" : "Record Sale"}
        </button>
      </form>

      {/* PL stock table (read-only now) */}
<StickyTable
  headers={[
    { label: "Date", className: "w-32" },
    { label: "Source", className: "w-36" },
    { label: "Grade", className: "w-24" },
    { label: "Thickness (mm)", className: "text-right w-36" },
    { label: "Size (mm)", className: "pl-4 border-l border-slate-200 w-40" },
    { label: "Available Weight (kg)", className: "text-right w-44" },
  ]}
>
  {rows.map((r) => (
    <tr key={r.id} className="border-t">
      <td>{r.production_date}</td>
      <td>{r.source_ref}</td>
      <td>{r.grade || "—"}</td>
      <td className="text-right">{r.thickness_mm ?? r.thickness ?? "—"}</td>
      <td className="pl-4 border-l border-slate-200">{r.size_mm}</td>
      <td className="text-right font-semibold">
        {fmt(r.available_weight_kg ?? r.available_kg ?? 0)}
      </td>
    </tr>
  ))}
  {!rows.length && (
    <tr>
      <td className="py-4 text-slate-500 text-center" colSpan={6}>
        All cleared 🎉 (no PL stock with balance &gt; 0)
      </td>
    </tr>
  )}
</StickyTable>
    </Section>
  );
}

/* ================================= PL SALES ================================= */
function PLSalesTab() {
  const [sales, setSales] = useState([]);

  const load = async () => {
    try {
      const res = await axios.get(`${API}/pl-sales`);
      setSales(res.data || []);
    } catch (err) {
      console.error("Failed to load PL sales", err);
      setSales([]);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const deleteSale = async (id) => {
    if (!confirm("Undo this PL sale?")) return;
    try {
      await axios.delete(`${API}/pl-sales/${id}`);
      load();
    } catch (err) {
      console.error("Failed to undo PL sale", err);
      alert("Error undoing PL sale. Check console for details.");
    }
  };

  return (
    <Section title="PL Sales" right={<ExportSheetButton tab="pl_sales" />} >
      <StickyTable
  headers={[
    { label: "Sale Date", className: "w-32" },
    { label: "Source", className: "w-36" },
    { label: "Grade", className: "w-24" },
    { label: "Thickness (mm)", className: "text-right w-36" },
    { label: "Size (mm)", className: "pl-4 border-l border-slate-200 w-40" },
    { label: "Buyer", className: "w-40" },
    { label: "Weight (kg)", className: "text-right w-40" },
    { label: "Price/kg", className: "text-right w-32" },
    { label: "Total Value", className: "text-right w-40" },
    { label: "", className: "w-20" },
  ]}
>
  {sales.map((s) => (
    <tr key={s.id} className="border-t">
      <td>{s.sale_date}</td>
      <td>{s.source_ref}</td>
      <td>{s.grade || "—"}</td>
      <td className="text-right">{s.thickness_mm ?? s.thickness ?? "—"}</td>
      <td className="pl-4 border-l border-slate-200">{s.size_mm ?? "—"}</td>
      <td>{s.buyer || "—"}</td>
      <td className="text-right">{fmt(s.sold_weight_kg)}</td>
      <td className="text-right">
        {s.price_per_kg != null ? fmt(s.price_per_kg) : "—"}
      </td>
      <td className="text-right">
        {s.price_per_kg != null ? fmt(s.price_per_kg * s.sold_weight_kg) : "—"}
      </td>
      <td>
        <button
          onClick={() => deleteSale(s.id)}
          className="px-2 py-1 text-red-600 border border-red-300 rounded hover:bg-red-50"
        >
          Undo
        </button>
      </td>
    </tr>
  ))}
  {!sales.length && (
    <tr>
      <td className="py-4 text-slate-500 text-center" colSpan={10}>
        No PL sales recorded.
      </td>
    </tr>
  )}
</StickyTable>
    </Section>
  );
}

/* =============================== DASHBOARD ================================ */
function DashboardTab() {
  const [data, setData] = useState(null);
  const [scrapTop, setScrapTop] = useState([]);   // [{ grade, kg }]
  const [scrapTotal, setScrapTotal] = useState(0);
  const [profitRows, setProfitRows] = useState([]); // 👈 coil profitability rows

  useEffect(() => {
    (async () => {
      // existing totals card data
      const dash = (await axios.get(`${API}/dashboard`)).data;
      setData(dash);

      // new: pull scrap rows and aggregate remaining by grade
      const res = await axios.get(`${API}/scrap`);
      const rows = res.data?.rows ?? [];

      const getRemaining = (r) =>
        Number(r?.remaining ?? r?.remaining_kg ?? r?.available_kg ?? 0);

      const agg = new Map();
      let grand = 0;
      for (const r of rows) {
        const rem = getRemaining(r);
        if (rem > 0) {
          const g = (r.grade ?? "Unknown").toString();
          agg.set(g, (agg.get(g) ?? 0) + rem);
          grand += rem;
        }
      }

      const top = Array.from(agg.entries())
        .map(([grade, kg]) => ({ grade, kg }))
        .sort((a, b) => b.kg - a.kg);

      setScrapTop(top);
      setScrapTotal(grand);

      // 👇 NEW: fetch profitability rows
      const profits = (await axios.get(`${API}/dashboard/profitability`)).data;
      setProfitRows(profits || []);
    })();
  }, []);

  if (!data) return <Section title="Dashboard">Loading…</Section>;

  const { totals } = data;
  const overallYield =
    totals.net_kg > 0 ? (100 * totals.circles_kg) / totals.net_kg : 0;

  return (
    <div className="space-y-4">
      {/* Overview cards */}
<Section title="Overview" right={<ExportSheetButton tab="all" />} >

  <div className="grid md:grid-cols-5 gap-3">
    <Card label="Total Net Input (kg)" value={totals.net_kg} />
    <Card label="Circles Output (kg)" value={totals.circles_kg} />
    <Card label="Patta (kg)" value={totals.patta_kg} />
    <Card label="Scrap (kg)" value={totals.scrap_kg} />
    <Card label="Overall Yield %" value={overallYield} suffix="%" />
  </div>
</Section>

      {/* Scrap by Grade */}
      <Section title="Scrap by Grade">
        <div className="bg-white rounded-xl p-3 shadow max-w-xl">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-600">
              <tr>
                <th>Grade</th>
                <th className="text-right">Remaining (kg)</th>
              </tr>
            </thead>
            <tbody className="[&>tr:nth-child(odd)]:bg-slate-50">
              {scrapTop.map((it, i) => (
                <tr key={it.grade + i} className="border-t">
                  <td>{it.grade}</td>
                  <td className="text-right">{fmt(it.kg)}</td>
                </tr>
              ))}
              {!scrapTop.length && (
                <tr>
                  <td colSpan={2} className="py-3 text-center text-slate-500">
                    All cleared 🎉 (no scrap with balance &gt; 0)
                  </td>
                </tr>
              )}
              <tr className="border-t bg-emerald-50 font-semibold">
                <td>Total</td>
                <td className="text-right">{fmt(scrapTotal)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      {/* 👇 NEW: Coil Profitability */}
      <Section title="Coil Profitability">
        <div className="bg-white rounded-xl p-3 shadow overflow-x-auto">
          <table className="w-full text-sm min-w-[600px]">
            <thead className="text-left text-slate-600">
              <tr>
                <th>Coil No.</th>
                <th className="text-right">Purchase Cost (₹)</th>
                <th className="text-right">Total Revenue (₹)</th>
                <th className="text-right">Profit (₹)</th>
              </tr>
            </thead>
            <tbody className="[&>tr:nth-child(odd)]:bg-slate-50">
              {profitRows.map((row, i) => (
                <tr key={row.coil_no + i} className="border-t">
                  <td>{row.coil_no}</td>
                  <td className="text-right">{fmt(row.purchase_cost)}</td>
                  <td className="text-right">{fmt(row.total_revenue)}</td>
                  <td
                    className={`text-right font-semibold ${
                      row.profit >= 0 ? "text-emerald-600" : "text-rose-600"
                    }`}
                  >
                    {fmt(row.profit)}
                  </td>
                </tr>
              ))}
              {!profitRows.length && (
                <tr>
                  <td colSpan={4} className="py-3 text-center text-slate-500">
                    No coil data yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

function Card({ label, value, suffix }) {
  return (
    <div className="bg-white rounded-xl p-4 shadow">
      <div className="text-slate-500 text-xs">{label}</div>
      <div className="text-lg font-semibold">
        {(value ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
        {suffix ? ` ${suffix}` : ""}
      </div>
    </div>
  );
}

/* ============================ COIL STOCK TAB ============================ */
function CoilStockTab() {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState([]);

  const load = async () => {
    const res = await axios.get(`${API}/coil-stock`, { params: { q } });
    const all = res.data || [];
    // Hide rows where available goes to 0 (supports alt field names if any)
    const filtered = all.filter(
      (s) => Number(s.available_weight_kg ?? s.available_kg ?? 0) > 0
    );
    setRows(filtered);
  };

  useEffect(() => {
    load();
  }, [q]);

  return (
  <Section
    title="Coil Stock"
    right={<ExportSheetButton tab="coil_stock" />}
  >
      {/* Search box */}
      <div className="mb-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search RN / Grade / Supplier..."
          className="border rounded-lg px-3 py-2 w-64"
        />
      </div>

      <StickyTable
  headers={[
    { label: "RN", className: "w-28" },
    { label: "Grade", className: "w-24" },
    { label: "Spec", className: "w-40" },
    { label: "Supplier", className: "w-40" },
    { label: "Purchase Date", className: "w-32" },
    { label: "Available Weight (kg)", className: "text-right w-48" },
  ]}
>
  {rows.map((s) => (
    <tr key={s.id} className="border-t">
      <td>{s.rn}</td>
      <td>{s.grade || "—"}</td>
      <td>
        {[
          s.thickness ? `${s.thickness}mm` : null,
          s.width ? `${s.width}mm` : null,
        ]
          .filter(Boolean)
          .join(" × ") || "—"}
      </td>
      <td>{s.supplier || "—"}</td>
      <td>{s.purchase_date || "—"}</td>
      <td className="text-right font-semibold">
        {fmt(s.available_weight_kg)}
      </td>
    </tr>
  ))}
  {!rows.length && (
    <tr>
      <td className="py-4 text-slate-500 text-center" colSpan={6}>
        All cleared 🎉 (no coils with balance &gt; 0)
      </td>
    </tr>
  )}
</StickyTable>
    </Section>
  );
}

/* ============================ COIL SALES TAB ============================ */
function CoilSalesTab() {
  const [q, setQ] = useState("");
  const [coilStock, setCoilStock] = useState([]);
  const [sales, setSales] = useState([]);

  const [form, setForm] = useState({
    coil_id: "",
    sold_weight_kg: "",
    buyer: "",
    price_per_kg: "",
    sale_date: "",
  });

  const loadStock = async () => {
    const res = await axios.get(`${API}/coil-stock`, { params: { q } });
    setCoilStock(res.data || []);
  };

  const loadSales = async () => {
    const res = await axios.get(`${API}/coil-direct-sales`);
    setSales(res.data || []);
  };

  useEffect(() => {
    loadStock();
    loadSales();
  }, [q]);

  const recordSale = async (e) => {
    e.preventDefault();
    if (!form.coil_id || !form.sold_weight_kg) return alert("Select coil & enter weight");

    await axios.post(`${API}/coils/${form.coil_id}/sell-direct`, form);
    setForm({ coil_id: "", sold_weight_kg: "", buyer: "", price_per_kg: "", sale_date: "" });
    loadStock();
    loadSales();
  };

  const undoSale = async (id) => {
    if (!window.confirm("Undo this sale?")) return;
    await axios.delete(`${API}/coil-direct-sales/${id}`);
    loadStock();
    loadSales();
  };

 return (
  <Section title="Coil Sales" right={<ExportSheetButton tab="coil_sales" />} >
      {/* Sale Form */}
      <form onSubmit={recordSale} className="mb-4 grid grid-cols-5 gap-3">
        <select
          value={form.coil_id}
          onChange={(e) => setForm({ ...form, coil_id: e.target.value })}
          className="border rounded px-2 py-1"
        >
          <option value="">-- Select Coil --</option>
          {coilStock.map((c) => (
            <option key={c.id} value={c.coil_id || c.id}>
              {c.rn} | {c.grade} | {fmt(c.available_weight_kg)}kg
            </option>
          ))}
        </select>
        <input
          type="number"
          placeholder="Weight (kg)"
          value={form.sold_weight_kg}
          onChange={(e) => setForm({ ...form, sold_weight_kg: e.target.value })}
          className="border rounded px-2 py-1"
        />
        <input
          placeholder="Buyer"
          value={form.buyer}
          onChange={(e) => setForm({ ...form, buyer: e.target.value })}
          className="border rounded px-2 py-1"
        />
        <input
          type="number"
          placeholder="Price/kg"
          value={form.price_per_kg}
          onChange={(e) => setForm({ ...form, price_per_kg: e.target.value })}
          className="border rounded px-2 py-1"
        />
        <input
          type="date"
          value={form.sale_date}
          onChange={(e) => setForm({ ...form, sale_date: e.target.value })}
          className="border rounded px-2 py-1"
        />
        <button type="submit" className="bg-blue-600 text-white px-3 py-1 rounded">
          Record Sale
        </button>
      </form>

      {/* Sales History */}
      <StickyTable
  headers={[
    { label: "Sale Date", className: "w-32" },
    { label: "RN", className: "w-28" },
    { label: "Grade", className: "w-24" },
    { label: "Weight (kg)", className: "text-right w-36" },
    { label: "Buyer", className: "w-40" },
    { label: "Price/kg", className: "text-right w-28" },
    { label: "Actions", className: "w-28" },
  ]}
>
  {sales.map((s) => (
    <tr key={s.id} className="border-t">
      <td>{s.sale_date}</td>
      <td>{s.rn}</td>
      <td>{s.grade}</td>
      <td className="text-right">{fmt(s.sold_weight_kg)}</td>
      <td>{s.buyer || "—"}</td>
      <td className="text-right">{s.price_per_kg || "—"}</td>
      <td>
        <button
          onClick={() => undoSale(s.id)}
          className="text-red-600 hover:underline"
        >
          Undo
        </button>
      </td>
    </tr>
  ))}
  {!sales.length && (
    <tr>
      <td colSpan={7} className="py-3 text-slate-500 text-center">
        No coil sales yet.
      </td>
    </tr>
  )}
</StickyTable>
    </Section>
  );
}

/* ============================ CIRCLE STOCK TAB ============================ */
function CircleStockTab() {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState("");

  const load = async () => {
    const res = await axios.get(`${API}/circle-stock-only`, { params: { q } });
    const all = res.data || [];
    // Hide rows where available goes to 0 (support both field names just in case)
    const filtered = all.filter(
      (s) => Number(s.available_weight_kg ?? s.available_kg ?? 0) > 0
    );
    setRows(filtered);
  };

  useEffect(() => {
    load();
  }, [q]);

  return (
     <Section title="Circle Stock" right={<ExportSheetButton tab="circle_stock" />} >
      <div className="mb-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search RN / Grade / Operator..."
          className="border rounded-lg px-3 py-2 w-64"
        />
      </div>

      <StickyTable
  headers={[
    { label: "Production Date", className: "text-left w-40" },
    { label: "Source", className: "text-left w-32" },
    { label: "Origin", className: "text-left w-24" },
    { label: "Grade", className: "text-left w-24" },
    { label: "Thickness (mm)", className: "text-left w-28" },
    { label: "Size (mm)", className: "text-left w-20" },
    { label: "Available Weight (kg)", className: "text-right w-40" },
    { label: "Order Match", className: "text-left w-auto" },
  ]}
>
  {rows.map((s) => (
    <tr key={s.id} className="border-t">
      <td>{s.production_date}</td>
      <td>{s.source_ref}</td>
      <td>{s.source_type === "patta" ? "Patta" : "Circle"}</td>
      <td>{s.grade || "—"}</td>
      <td>{s.thickness_mm ?? "—"}</td>
      <td>{s.size_mm ?? "—"}</td>
      <td className="text-right font-semibold">
        {fmt(s.available_weight_kg ?? s.available_kg ?? 0)}
      </td>
      <td>
        <CircleOrderMatch stock={s} onSaved={load} />
      </td>
    </tr>
  ))}

  {!rows.length && (
    <tr>
      <td colSpan={8} className="py-4 text-slate-500 text-center">
        All cleared 🎉 (no circle stock with balance &gt; 0)
      </td>
    </tr>
  )}
</StickyTable>
    </Section>
  );
}

/* ===== Circle → inline Order matcher + quick sale ===== */
function CircleOrderMatch({ stock, onSaved }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState(null);
  const [showSale, setShowSale] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    sold_weight_kg: "",
    price_per_kg: "",
    sale_date: "",
  });

  useEffect(() => {
    let ok = true;
    (async () => {
      try {
        setLoading(true);
        const res = await axios.get(`${API}/circle-stock/${stock.id}/matches`);
        if (ok) setOrders(res.data?.matches || []);
      } catch {
        if (ok) setOrders([]);
      } finally {
        if (ok) setLoading(false);
      }
    })();
    return () => {
      ok = false;
    };
  }, [stock.id]);

  // listen for global refresh events and reload matches
  useEffect(() => {
    const reload = async () => {
      try {
        const res = await axios.get(`${API}/circle-stock/${stock.id}/matches`);
        setOrders(res.data?.matches || []);
      } catch {
        setOrders([]);
      }
    };

    const handler = () => reload();
    window.addEventListener("matches:refresh", handler);
    return () => window.removeEventListener("matches:refresh", handler);
  }, [stock.id]);

  const startQuickSale = (order) => {
    setPicked(order);
    setShowSale(true);

    const orderRemainKg = Math.max(0, Number(order.remaining_weight_kg || 0));
    const kg = Math.min(Number(stock.available_weight_kg ?? stock.available_kg ?? 0), orderRemainKg || 0);

    setForm({
      sold_weight_kg: kg || "",
      price_per_kg: "",
      sale_date: new Date().toISOString().slice(0, 10),
    });
  };

  const saveQuickSale = async (e) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);

    try {
      const maxWt = Number(stock.available_weight_kg ?? stock.available_kg ?? 0);
      const wt = Math.min(maxWt, Number(form.sold_weight_kg || 0));

      if (wt <= 0) {
        alert("Weight must be > 0.");
        return;
      }

      const payload = {
        stock_id: Number(stock.id),
        sold_weight_kg: wt,
        buyer: picked?.company || null,
        price_per_kg: form.price_per_kg ? Number(form.price_per_kg) : null,
        sale_date: form.sale_date || undefined,
        order_no: picked?.order_no || null,
      };
      await axios.post(`${API}/circle-sales`, payload);

      if (picked?.order_no) {
        const upd = await axios.post(`${API}/orders/${picked.order_no}/update-status`);
        if (upd?.data?.status === "fulfilled") {
          setOrders((prev) => prev.filter((o) => o.order_no !== picked.order_no));
        }
      }

// 🔔 tell everyone to refresh
window.dispatchEvent(new Event("matches:refresh"));

      setShowSale(false);
      onSaved?.(); // reloads list; zero-balance rows will disappear
    } catch (err) {
      console.error("Quick sale failed", err);
      alert("Failed to record sale.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <span className="text-xs text-slate-500">loading…</span>;
  if (!orders.length && !showSale) return <span className="text-xs text-slate-400">—</span>;

  const maxWt = Number(stock.available_weight_kg ?? stock.available_kg ?? 0);

  return (
    <div className="flex flex-col gap-1">
      {!showSale &&
        orders.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {orders.map((m) => (
              <button
                key={m.order_no}
                onClick={() => startQuickSale(m)}
                className="text-xs px-2 py-1 rounded border hover:bg-slate-50"
                title={`Order #${m.order_no}`}
              >
                {m.company || "—"} • {m.grade || "—"} •
                {m.thickness_mm ?? "—"} × {m.op_size_mm ?? "—"} •{" "}
                {fmt(m.remaining_weight_kg)}kg
              </button>
            ))}
          </div>
        )}

      {showSale && (
        <form
          onSubmit={saveQuickSale}
          className="bg-slate-50 rounded p-2 text-xs grid grid-cols-2 gap-2"
        >
          <div className="col-span-2">
            <div className="font-medium">
              {picked?.company || "—"} • {picked?.grade || "—"} •{" "}
              {picked?.thickness_mm ?? "—"} × {picked?.op_size_mm ?? "—"} •{" "}
              {fmt(picked?.remaining_weight_kg)}kg
            </div>
            <div className="flex gap-2 mt-1">
              <button
                type="button"
                onClick={() => {
                  const orderRemainKg = Math.max(
                    0,
                    Number(picked?.remaining_weight_kg || 0)
                  );
                  setForm({
                    ...form,
                    sold_weight_kg:
                      Math.min(Number(stock.available_weight_kg ?? stock.available_kg ?? 0), orderRemainKg || 0) ||
                      "",
                  });
                }}
                className="px-2 py-1 rounded border"
                title="Prefill using the order's remaining quantities"
              >
                Use Order Remaining
              </button>
            </div>
          </div>

          <input
            type="number"
            step="any"
            max={maxWt}
            placeholder="Weight (kg)"
            value={form.sold_weight_kg}
            onChange={(e) => {
              const v = Number(e.target.value || 0);
              const clamped = Math.max(0, Math.min(v, maxWt));
              setForm({ ...form, sold_weight_kg: clamped });
            }}
            className="border rounded px-2 py-1"
            inputMode="decimal"
          />
          <input
            type="number"
            step="any"
            placeholder="Price/kg"
            value={form.price_per_kg}
            onChange={(e) => setForm({ ...form, price_per_kg: e.target.value })}
            className="border rounded px-2 py-1"
          />
          <input
            type="date"
            value={form.sale_date}
            onChange={(e) => setForm({ ...form, sale_date: e.target.value })}
            className="border rounded px-2 py-1"
          />
          <div className="col-span-2 flex gap-2">
            <button disabled={saving} className="px-2 py-1 rounded bg-emerald-600 text-white">
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setShowSale(false)}
              className="px-2 py-1 rounded border"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}


/* ============================ CIRCLE SALES TAB ============================ */
function CircleSalesTab() {
  const [sales, setSales] = useState([]);
  const [circleStock, setCircleStock] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    stock_id: "",
    sold_qty: "",
    sold_weight_kg: "",
    buyer: "",
    price_per_kg: "",
    sale_date: "",
  });

  const load = async () => {
    const resSales = await axios.get(`${API}/circle-sales`);
    setSales(resSales.data || []);
    const resStock = await axios.get(`${API}/circle-stock-only`);
    setCircleStock(resStock.data || []);
  };

  useEffect(() => {
    load();
  }, []);

  const save = async (e) => {
    e.preventDefault();
    if (!form.stock_id || !form.sold_qty || !form.sold_weight_kg) {
      return alert("Please select stock, qty and weight");
    }
    await axios.post(`${API}/circle-sales`, {
      ...form,
      stock_id: Number(form.stock_id),
      sold_qty: Number(form.sold_qty),
      sold_weight_kg: Number(form.sold_weight_kg),
    });
    setForm({
      stock_id: "",
      sold_qty: "",
      sold_weight_kg: "",
      buyer: "",
      price_per_kg: "",
      sale_date: "",
    });
    setShowForm(false);
    load();
  };

  const undo = async (id) => {
    if (!confirm("Undo this sale?")) return;
    await axios.delete(`${API}/circle-sales/${id}`);
    load();
  };

  return (
    <Section title="Circle Sales"
  right={
    <div className="flex items-center gap-2">
      <ExportSheetButton tab="circle_sales" />
      <button
        onClick={() => setShowForm(!showForm)}
        className="bg-green-600 text-white rounded-lg px-3 py-2"
      >
        {showForm ? "Cancel" : "Record Circle Sale"}
      </button>
    </div>
  }
>
      {showForm && (
        <form
          onSubmit={save}
          className="bg-slate-50 rounded-lg p-4 mb-4 grid grid-cols-2 md:grid-cols-3 gap-3"
        >
          <h3 className="col-span-full font-semibold">Record New Circle Sale</h3>
          <label className="text-sm">
            <div className="text-slate-600 mb-1">Select Stock</div>
            <select
              value={form.stock_id}
              onChange={(e) => {
                const s = circleStock.find((r) => r.id == e.target.value);
                setForm({
                  ...form,
                  stock_id: e.target.value,
                  sold_qty: s?.available_qty || "",
                  sold_weight_kg: s?.available_weight_kg || "",
                });
              }}
              className="border rounded-lg px-3 py-2"
              required
            >
              <option value="">Select…</option>
              {circleStock.filter((s) => s.available_qty > 0).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.source_ref} - {s.grade || "—"} - {s.size_mm ?? "—"}mm (
                  {fmt(s.available_qty)} pcs, {fmt(s.available_weight_kg)}kg)
                </option>
              ))}
            </select>
          </label>
          <NumberInput
            label="Sold Pcs"
            value={form.sold_qty}
            onChange={(e) => setForm({ ...form, sold_qty: e.target.value })}
            required
          />
          <NumberInput
            label="Sold Weight (kg)"
            value={form.sold_weight_kg}
            onChange={(e) => setForm({ ...form, sold_weight_kg: e.target.value })}
            required
          />
          <Input	
            label="Buyer"
            value={form.buyer}
            onChange={(e) => setForm({ ...form, buyer: e.target.value })}
          />
          <NumberInput
            label="Price/kg"
            value={form.price_per_kg}
            onChange={(e) => setForm({ ...form, price_per_kg: e.target.value })}
          />
          <Input
            label="Sale Date"
            type="date"
            value={form.sale_date}
            onChange={(e) => setForm({ ...form, sale_date: e.target.value })}
          />
          <div className="col-span-full">
            <button
              type="submit"
              className="bg-green-600 text-white rounded-lg px-4 py-2"
            >
              Save Sale
            </button>
          </div>
        </form>
      )}

      <StickyTable
  headers={[
    { label: "Sale Date", className: "w-28" },
    { label: "Source", className: "w-32" },
    { label: "Grade", className: "w-24" },
    { label: "Thickness (mm)", className: "w-28" },
    { label: "Size (mm)", className: "w-20" },
    { label: "Buyer", className: "w-36" },
    { label: "Pcs", className: "text-right w-24" },
    { label: "Weight (kg)", className: "text-right w-32" },
    { label: "Price/kg", className: "text-right w-28" },
    { label: "Total Value", className: "text-right w-32" },
    { label: "", className: "w-20" },
  ]}
>
  {sales.map((s) => (
    <tr key={s.id} className="border-t">
      <td>{s.sale_date}</td>
      <td>{s.source_ref}</td>
      <td>{s.grade ?? "—"}</td>
      <td>{s.thickness_mm ?? s.thickness ?? "—"}</td>
      <td>{s.size_mm ?? "—"}</td>
      <td>{s.buyer || "—"}</td>
      <td className="text-right">{fmt(s.sold_qty)}</td>
      <td className="text-right">{fmt(s.sold_weight_kg)}</td>
      <td className="text-right">{s.price_per_kg ? fmt(s.price_per_kg) : "—"}</td>
      <td className="text-right">
        {s.price_per_kg ? fmt(s.sold_weight_kg * s.price_per_kg) : "—"}
      </td>
      <td>
        <button
          onClick={() => undo(s.id)}
          className="px-2 py-1 text-red-600 border border-red-300 rounded hover:bg-red-50"
        >
          Undo
        </button>
      </td>
    </tr>
  ))}

  {!sales.length && (
    <tr>
      <td className="py-4 text-slate-500" colSpan={11}>
        No circle sales recorded.
      </td>
    </tr>
  )}
</StickyTable>
    </Section>
  );
}

/* =============================== PLANNING =============================== */

function PlanningTab() {
  const [rows, setRows] = useState([]);
  const [usablePct, setUsablePct] = useState(82);

  useEffect(() => {
    const load = async () => {
      const [ordersRes, circleRes, coilRes] = await Promise.all([
        axios.get(`${API}/orders`),
        axios.get(`${API}/circle-stock`),
        axios.get(`${API}/coil-stock`),
      ]);

      const orders = ordersRes.data || [];
      const circleStock = circleRes.data || [];
      const coilStock = coilRes.data || [];

      const summary = {};

      // --- Aggregate order data ---
      for (const o of orders) {
  // ✅ skip cancelled orders
  if (o.status && o.status.toLowerCase() === "cancelled") continue;

  const thicknessVal = o.thickness ?? o.thickness_mm ?? null;
  const sizeVal = o.op_size ?? o.size ?? o.circle_size ?? null;
  const key = `${o.grade}-${thicknessVal}-${sizeVal}`;

        if (!summary[key]) {
          summary[key] = {
            grade: o.grade,
            thickness: thicknessVal,
            size: sizeVal,
            ordered: 0,
            fulfilled: 0,
            circle: 0,
            coil: 0,
          };
        }

        const orderedVal = Number(o.ordered_weight_kg ?? o.ordered_kg ?? o.weight ?? 0) || 0;
        const fulfilledVal = Number(o.fulfilled_weight_kg ?? o.fulfilled_kg ?? 0) || 0;

        summary[key].ordered += orderedVal;
        summary[key].fulfilled += fulfilledVal;
      }

      // --- Circle stock aggregation (only deduct if size matches) ---
      for (const c of circleStock) {
        const thicknessVal = c.thickness ?? c.thickness_mm ?? null;
        const sizeVal = c.size ?? c.circle_size ?? null;
        const key = `${c.grade}-${thicknessVal}-${sizeVal}`;

        if (summary[key]) {
          // Only add to summary if there is an order with same grade+thickness+size
          const circleAvail = Number(c.available_weight_kg ?? c.available_kg ?? 0) || 0;
          summary[key].circle += circleAvail;
        }
      }

      // --- Coil stock aggregation (no size check needed) ---
      for (const c of coilStock) {
        const thicknessVal = c.thickness ?? c.thickness_mm ?? null;
        const key = `${c.grade}-${thicknessVal}-null`; // coil has no circle size

        if (!summary[key]) {
          summary[key] = {
            grade: c.grade,
            thickness: thicknessVal,
            size: null,
            ordered: 0,
            fulfilled: 0,
            circle: 0,
            coil: 0,
          };
        }
        const coilAvail = Number(c.available_weight_kg ?? c.available_kg ?? 0) || 0;
        summary[key].coil += coilAvail;
      }

      const usableFactor = (Number(usablePct) || 0) / 100;

      // --- Build rows ---
      const out = Object.values(summary).map((s) => {
        const ordered = Number(s.ordered) || 0;
        const fulfilled = Number(s.fulfilled) || 0;
        const circle = Number(s.circle) || 0;
        const coilRaw = Number(s.coil) || 0;

        const coilUsableOutput = coilRaw * usableFactor;

        const netRemaining = Math.max((ordered - fulfilled) - circle - coilUsableOutput, 0);

        const coilRequired = netRemaining > 0 && usableFactor > 0
          ? netRemaining / usableFactor
          : 0;

        return {
          grade: s.grade,
          thickness: s.thickness,
          ordered,
          fulfilled,
          circle,
          coilUsable: coilUsableOutput,
          netRemaining,
          coilRequired,
        };
      });

      setRows(out.filter((r) => r.netRemaining > 0 && r.coilRequired > 0));
    };

    load();
  }, [usablePct]);

  return (
    <Section title="Planning">
      <div className="mb-3 flex items-center gap-3">
        <label className="text-sm text-slate-600">Usable %:</label>
        <input
          type="number"
          className="border rounded px-2 py-1 w-20"
          value={usablePct}
          onChange={(e) => setUsablePct(Number(e.target.value) || 0)}
        />
      </div>

      <StickyTable
  headers={[
    { label: "Grade", className: "px-3 py-3 w-28" },
    { label: "Thickness (mm)", className: "px-3 py-3 w-36" },
    { label: "Ordered Kg", className: "text-right px-3 py-3 w-36" },
    { label: "Fulfilled Kg", className: "text-right px-3 py-3 w-36" },
    { label: "Circle Stock", className: "text-right px-3 py-3 w-36" },
    { label: "Coil Stock (Usable)", className: "text-right px-3 py-3 w-44" },
    { label: "Remaining Order Kg", className: "text-right px-3 py-3 w-44" },
    { label: "Coil Kg Required", className: "text-right px-3 py-3 w-44" },
  ]}
>
  {rows.map((r, i) => (
    <tr key={i} className="border-t">
      <td className="px-3 py-3">{r.grade}</td>
      <td className="px-3 py-3">{r.thickness}</td>
      <td className="px-3 py-3 text-right">{fmt(r.ordered)}</td>
      <td className="px-3 py-3 text-right">{fmt(r.fulfilled)}</td>
      <td className="px-3 py-3 text-right">{fmt(r.circle)}</td>
      <td className="px-3 py-3 text-right">{fmt(r.coilUsable)}</td>
      <td className="px-3 py-3 text-right">{fmt(r.netRemaining)}</td>
      <td className="px-3 py-3 text-right font-semibold text-sky-700">
        {r.coilRequired > 0
          ? Number(r.coilRequired).toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })
          : "—"}
      </td>
    </tr>
  ))}

  {!rows.length && (
    <tr>
      <td colSpan={8} className="py-4 text-center text-slate-500">
        No planning data.
      </td>
    </tr>
  )}
</StickyTable>
    </Section>
  );
}

// ============================= USERS TAB =============================

function UsersTab() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [newUser, setNewUser] = useState({ username: "", password: "", role: "user" });

  const API = process.env.REACT_APP_API || "/api";

  const loadUsers = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/users`);
      setUsers(res.data);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleCreate = async () => {
    if (!newUser.username || !newUser.password) return alert("Username & password required");
    try {
      await axios.post(`${API}/users`, newUser);
      setNewUser({ username: "", password: "", role: "user" });
      loadUsers();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to create user");
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this user?")) return;
    try {
      await axios.delete(`${API}/users/${id}`);
      loadUsers();
    } catch (err) {
      alert(err.response?.data?.error || "Failed to delete user");
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold">User Management</h2>

      {error && <div className="text-red-500">{error}</div>}

      {/* User list */}
      {loading ? (
        <div>Loading...</div>
      ) : (
        <table className="w-full border text-sm">
          <thead className="bg-slate-200">
            <tr>
              <th className="px-2 py-1 border">ID</th>
              <th className="px-2 py-1 border">Username</th>
              <th className="px-2 py-1 border">Role</th>
              <th className="px-2 py-1 border">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td className="px-2 py-1 border">{u.id}</td>
                <td className="px-2 py-1 border">{u.username}</td>
                <td className="px-2 py-1 border">{u.role}</td>
                <td className="px-2 py-1 border">
                  <button
                    onClick={() => handleDelete(u.id)}
                    className="px-2 py-1 text-white bg-red-500 rounded"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Add new user */}
      <div className="p-4 border rounded space-y-2">
        <h3 className="font-semibold">Create New User</h3>
        <input
          type="text"
          placeholder="Username"
          className="border rounded px-2 py-1 w-full"
          value={newUser.username}
          onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
        />
        <input
          type="password"
          placeholder="Password"
          className="border rounded px-2 py-1 w-full"
          value={newUser.password}
          onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
        />
        <select
          className="border rounded px-2 py-1 w-full"
          value={newUser.role}
          onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
        >
          <option value="user">User</option>
          <option value="admin">Admin</option>
        </select>
        <button
          onClick={handleCreate}
          className="w-full bg-sky-600 text-white rounded px-3 py-1"
        >
          Create User
        </button>
      </div>
    </div>
  );
}


/* =============================== APP WRAPPER =============================== */

// 🔹 Axios Interceptor: Attach token to every request automatically
axios.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;	
});

// 🔹 Auto-logout on 401 (token expired/invalid)
if (!window.__axios401Interceptor) {
  window.__axios401Interceptor = axios.interceptors.response.use(
    (res) => res,
    (err) => {
      const status = err?.response?.status;
      if (status === 401) {
        // clear token and tell the app to show Login
        localStorage.removeItem("token");
        window.dispatchEvent(new Event("auth:logout"));
      }
      return Promise.reject(err);
    }
  );
}

export default function App() {
  const [token, setToken] = useState(localStorage.getItem("token") || null);
  const [tab, setTab] = useState("coils");
  const [focusCircleId, setFocusCircleId] = useState(null);

  const role = useMemo(() => {
    try {
      const payload = token ? JSON.parse(atob(token.split(".")[1])) : null;
      return payload?.role || "user";
    } catch {
      return "user";
    }
  }, [token]);

  useEffect(() => {
    const onLogout = () => setToken(null);
    window.addEventListener("auth:logout", onLogout);
    return () => window.removeEventListener("auth:logout", onLogout);
  }, []);


  // If not logged in, show login page
  if (!token) {
    return (
      <Login
        onLogin={(tok) => {
          localStorage.setItem("token", tok);
          setToken(tok);
          setTab("coils");        }}
      />
    );
  }

  const handleStartedCircle = (newId) => {
    setFocusCircleId(newId);
    setTab("circle");
  };

  return (
    <div className="w-screen max-w-none px-4 space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Steel Tracker</h1>

        <div className="flex items-center gap-3">
          <nav className="flex flex-wrap gap-2">
            <TabBtn on={() => setTab("coils")} active={tab === "coils"}>Coils</TabBtn>
            <TabBtn on={() => setTab("coilstock")} active={tab === "coilstock"}>Coil Stock</TabBtn>
            <TabBtn on={() => setTab("coilsales")} active={tab === "coilsales"}>Coil Sales</TabBtn>
            <TabBtn on={() => setTab("circle")} active={tab === "circle"}>Circle</TabBtn>
            <TabBtn on={() => setTab("circlestock")} active={tab === "circlestock"}>Circle Stock</TabBtn>
            <TabBtn on={() => setTab("circlesales")} active={tab === "circlesales"}>Circle Sales</TabBtn>
            <TabBtn on={() => setTab("patta")} active={tab === "patta"}>Patta</TabBtn>
            <TabBtn on={() => setTab("plstock")} active={tab === "plstock"}>PL Stock</TabBtn>
            <TabBtn on={() => setTab("plsales")} active={tab === "plsales"}>PL Sales</TabBtn>
            <TabBtn on={() => setTab("scrap")} active={tab === "scrap"}>Scrap</TabBtn>
            <TabBtn on={() => setTab("yield")} active={tab === "yield"}>Yield</TabBtn>
            <TabBtn on={() => setTab("dashboard")} active={tab === "dashboard"}>Dashboard</TabBtn>
            <TabBtn on={() => setTab("orders")} active={tab === "orders"}>Orders</TabBtn>
            <TabBtn on={() => setTab("dispatched")} active={tab === "dispatched"}>Dispatched</TabBtn>
            <TabBtn on={() => setTab("planning")} active={tab === "planning"}>Planning</TabBtn>
          {role === "admin" && (
            <TabBtn on={() => setTab("users")} active={tab === "users"}>Users</TabBtn>
          )}

          </nav>

          {/* 🔴 Logout Button */}
          <button
            onClick={() => {
              localStorage.removeItem("token");
              setToken(null);
            }}
            className="px-3 py-1 rounded bg-red-500 text-white"
          >
            Logout
          </button>
        </div>
      </header>

      {tab === "coils" && <Coils onStartedCircle={handleStartedCircle} />}
      {tab === "coilstock" && <CoilStockTab />}
      {tab === "coilsales" && <CoilSalesTab />}
      {tab === "circle" && <CircleTab focusId={focusCircleId} />}
      {tab === "circlestock" && <CircleStockTab />}
      {tab === "circlesales" && <CircleSalesTab />}
      {tab === "patta" && <PattaTab />}
      {tab === "plstock" && <PLStockTab />}
      {tab === "plsales" && <PLSalesTab />}
      {tab === "scrap" && <ScrapTab />}
      {tab === "yield" && <YieldTab />}
      {tab === "dashboard" && <DashboardTab />}
      {tab === "orders" && <OrdersTab />}
      {tab === "dispatched" && <DispatchedTab />}
      {tab === "planning" && <PlanningTab />}
      {tab === "users" && (role === "admin" ? (
        <UsersTab />
      ) : (
        <Section title="User Management">
          <div className="text-slate-600">Only admins can view this page.</div>
        </Section>
      ))}

    </div>
  );
}

function TabBtn({ children, active, on }) {
  return (
    <button
      onClick={on}
      className={`px-3 py-1 rounded ${
        active ? "bg-sky-600 text-white" : "border"
      }`}
    >
      {children}
    </button>
  );
}


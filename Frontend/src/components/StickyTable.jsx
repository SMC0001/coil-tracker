// Frontend/src/components/StickyTable.jsx
export default function StickyTable({ headers, children }) {
  return (
    <div className="overflow-y-auto overflow-x-auto max-h-[70vh] border rounded">
      <table className="w-full text-sm">
        <thead className="text-left text-slate-600 sticky top-0 bg-gray-100 z-10 shadow-sm">
          <tr>
            {headers.map((h, i) => (
              <th key={i} className={h.className || "py-2"}>
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr:nth-child(odd)]:bg-slate-50">
          {children}
        </tbody>
      </table>
    </div>
  );
}

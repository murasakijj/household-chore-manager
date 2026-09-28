import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";

export default function PageHeader({
  title,
  back = false,
  actions,
}: {
  title: string;
  back?: boolean;
  actions?: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <header className="page-header">
      {back && (
        <button
          type="button"
          className="icon-btn"
          aria-label="戻る"
          onClick={() => navigate(-1)}
        >
          ←
        </button>
      )}
      <h1 className="page-title">{title}</h1>
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  );
}

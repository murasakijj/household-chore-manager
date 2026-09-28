import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
} from "react-router-dom";
import { AuthProvider } from "./contexts/AuthContext";
import SettingsProvider from "./contexts/SettingsProvider";
import ToastProvider from "./components/ToastProvider";
import RequireAuth from "./components/RequireAuth";
import AppShell from "./components/AppShell";
import Login from "./pages/Login";
import Today from "./pages/Today";
import ChoreList from "./pages/ChoreList";
import ChoreDetail from "./pages/ChoreDetail";
import ChoreForm from "./pages/ChoreForm";
import ChorePropose from "./pages/ChorePropose";
import ChoreRecord from "./pages/ChoreRecord";
import History from "./pages/History";
import Settings from "./pages/Settings";
import AreasSettings from "./pages/settings/AreasSettings";
import CategoriesSettings from "./pages/settings/CategoriesSettings";
import ResourcesSettings from "./pages/settings/ResourcesSettings";

function ProtectedLayout() {
  return (
    <RequireAuth>
      <SettingsProvider>
        <AppShell>
          <Outlet />
        </AppShell>
      </SettingsProvider>
    </RequireAuth>
  );
}

function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<ProtectedLayout />}>
              <Route path="/" element={<Today />} />
              <Route path="/chores" element={<ChoreList />} />
              <Route path="/chores/new" element={<ChoreForm />} />
              <Route path="/chores/propose" element={<ChorePropose />} />
              <Route path="/chores/:id" element={<ChoreDetail />} />
              <Route path="/chores/:id/edit" element={<ChoreForm />} />
              <Route path="/chores/:id/record" element={<ChoreRecord />} />
              <Route path="/history" element={<History />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/settings/areas" element={<AreasSettings />} />
              <Route
                path="/settings/categories"
                element={<CategoriesSettings />}
              />
              <Route
                path="/settings/resources"
                element={<ResourcesSettings />}
              />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}

export default App;

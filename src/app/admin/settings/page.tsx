import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import Topbar from "@/components/topbar";
import SettingsPage from "@/components/profile-settings";
import { adminNav } from "@/lib/nav";
import PageHeader from "@/components/page-header";

const NAV = adminNav("/admin/settings");

export default async function AdminSettingsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <>
      <Topbar links={NAV} role="admin" />
      <main id="main" className="container settings-container" tabIndex={-1}>
        <PageHeader kicker="Settings" title="Settings" sub="Manage your profile information." />
        <SettingsPage
          initialName={user.name}
          initialUsername={user.username}
          initialAvatarUrl={user.avatarUrl}
          initialEmail={user.email}
          role={user.role}
        />
      </main>
      <footer className="footer">Inland Green Bank. Admin Console</footer>
    </>
  );
}

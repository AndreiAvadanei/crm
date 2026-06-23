import { requireAdmin } from "@/lib/auth/guards";
import { brandingLogoVersion } from "@/lib/branding";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { BrandingForm } from "@/components/admin/branding-form";

export const metadata = {
  title: "Branding",
};

export default async function BrandingPage() {
  await requireAdmin();
  const [light, dark] = await Promise.all([
    brandingLogoVersion("light"),
    brandingLogoVersion("dark"),
  ]);

  return (
    <div>
      <PageHeader
        title="Branding"
        description="Upload your project logo (PNG) for light and dark mode. It replaces the title in the sidebar."
      />
      <div className="grid gap-6 p-4 md:grid-cols-2 md:p-6">
        <Card>
          <CardHeader>
            <CardTitle>Light mode logo</CardTitle>
            <CardDescription>Shown when the app uses the light theme.</CardDescription>
          </CardHeader>
          <CardContent>
            <BrandingForm mode="light" version={light} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Dark mode logo</CardTitle>
            <CardDescription>Shown when the app uses the dark theme.</CardDescription>
          </CardHeader>
          <CardContent>
            <BrandingForm mode="dark" version={dark} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

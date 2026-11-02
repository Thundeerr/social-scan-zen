import { createFileRoute } from "@tanstack/react-router";
import { SmartlinkStudio } from "@/components/smartlink-studio";
export const Route = createFileRoute("/_authenticated/smartlinks/")({
  component: () => <SmartlinkStudio mode="links" />,
});

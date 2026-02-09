import { SignUp } from "@clerk/nextjs";

export default function Page() {
  return (
    <main style={{ maxWidth: 880, margin: "0 auto", padding: "48px 16px" }}>
      <SignUp />
    </main>
  );
}

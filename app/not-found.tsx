import type { Metadata } from "next";

export const metadata: Metadata = { title: "Nothing in this safe" };

export default function NotFound() {
  return (
    <main className="section" id="main">
      <div className="shell notfound">
        <p className="eyebrow">ERROR 404</p>
        <h1 className="section-title">THIS SAFE IS EMPTY</h1>
        <p className="section-lead">
          The raider got here first, or the page never existed. Either way — nothing to
          stack on this page.
        </p>
        <a className="btn btn-neon lg" href="/">
          BACK TO THE MACHINE
        </a>
      </div>
    </main>
  );
}

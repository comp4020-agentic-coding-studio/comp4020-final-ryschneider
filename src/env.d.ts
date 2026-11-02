/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    user: import("./lib/schema").User | null;
  }
}

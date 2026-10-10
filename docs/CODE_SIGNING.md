# Windows Code Signing

The installers are currently **unsigned**, which is why SmartScreen shows
"Windows protected your PC" on first run. Signing removes that warning and
shows your company/developer name as the publisher.

Signing cannot be faked locally — it requires a certificate issued by a
trusted CA. Two viable routes:

## Route A — Azure Trusted Signing (recommended, ~$9.99/month)

Microsoft's modern signing service. No certificate file to manage; signing
happens in the cloud from CI. Requires an **Azure subscription** and an
organization identity that Microsoft verifies (can take a few days for
new GitHub orgs / personal accounts).

1. Create an Azure account with an active subscription.
2. In the Azure portal create a **Trusted Signing** resource
   (Account → `Trusted signing` → create) in a supported region
   (e.g. `eastus2` or `westeurope`).
3. Create a **certificate profile** of type *Public trust → Code signing*.
4. Create an App registration → client secret; grant it the
   **Trusted Signing Certificate Profile Signer** role on the resource.
5. Add these **repository secrets** (Settings → Secrets → Actions):

   | Secret | Value |
   | --- | --- |
   | `AZURE_TENANT_ID` | Directory (tenant) ID |
   | `AZURE_CLIENT_ID` | Application (client) ID |
   | `AZURE_CLIENT_SECRET` | Client secret value |
   | `AZURE_TRUSTED_SIGNING_ENDPOINT` | e.g. `https://wussig-eastus2.trustedsigning.azure.net/` |
   | `AZURE_TRUSTED_SIGNING_ACCOUNT` | Trusted Signing account name |
   | `AZURE_TRUSTED_SIGNING_CERT_PROFILE` | Certificate profile name |

6. Add the signing block to `electron-builder.yml`
   (electron-builder ≥ 26 supports it natively):

   ```yaml
   win:
     signtoolOptions:
       azureSignOptions:
         codeSigningAccountName: $AZURE_TRUSTED_SIGNING_ACCOUNT
         certificateProfileName: $AZURE_TRUSTED_SIGNING_CERT_PROFILE
         endpoint: $AZURE_TRUSTED_SIGNING_ENDPOINT
         tenantId: $AZURE_TENANT_ID
         clientId: $AZURE_CLIENT_ID
         clientSecret: $AZURE_CLIENT_SECRET
   ```

   (In CI the values come from the secrets — wire them in
   `.github/workflows/release.yml` under the Windows job's
   `electron-builder` step `env:`.)

7. Push a new tag (`git tag v1.0.2 && git push origin v1.0.2`) — the
   Release workflow builds and signs automatically.

Identity validation (GVW / org verification) must complete **before** the
first signed build, otherwise the certificate cannot be issued.

## Route B — Classic PFX certificate (OV/EV, one-time purchase)

Buy a code-signing certificate from DigiCert, Sectigo, SSL.com, Certum, etc.
Prices vary (~$70–$400 for OV; EV is more but grants SmartScreen reputation
immediately instead of building it over time). You receive a `.pfx`/`.p12`
file and a password.

1. Convert the PFX to a single-line base64 string:

   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("codesign.pfx"))
   ```

2. Add **repository secrets**:

   | Secret | Value |
   | --- | --- |
   | `WIN_CSC_LINK` | The base64 string from step 1 |
   | `WIN_CSC_PASSWORD` | The PFX password |

3. The Release workflow already passes these to electron-builder
   (`CSC_LINK` / `CSC_KEY_PASSWORD`) and **fails the build if the
   resulting signature is not Valid** — no other changes needed.

4. Local signed build:

   ```powershell
   $env:CSC_LINK = "C:\certs\codesign.pfx"
   $env:CSC_KEY_PASSWORD = "..."
   npm run dist:win
   ```

## Verifying a build

```powershell
pwsh scripts/verify-signature.ps1 -Path "release\internpulse-ai-1.0.1-win-x64-setup.exe"
```

Expected output when signed: `Status: Valid` and the publisher subject.
Unsigned builds report `Status: NotSigned`.

## macOS signing (optional, same mechanism)

Set `APPLE_CERT_LINK` (base64 Developer ID Application `.p12`) and
`APPLE_CERT_PASSWORD` repo secrets — the macOS job in the Release workflow
already forwards them. Notarization (required to skip Gatekeeper prompts)
needs additional Apple ID secrets and a `notarize` block; without them the
DMG is unsigned and users must right-click → Open.

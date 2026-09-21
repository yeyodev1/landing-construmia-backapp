import fs from "fs";
import path from "path";
import { v2 as cloudinary } from "cloudinary";
import { env } from "../config/env";

/**
 * Sube el material del cliente a Cloudinary conservando la estructura de carpetas.
 * El public_id es determinista (construmia/<carpeta>/<archivo>), así el frontend arma
 * las URLs sin necesitar un manifiesto. Idempotente: lo que ya existe no se vuelve a subir.
 *
 * Uso: pnpm upload:media [ruta-al-material]
 */
const ROOT_FOLDER = "construmia";
const DEFAULT_SOURCE = path.resolve(__dirname, "../../../material-construmia");

function listImages(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listImages(full);
    return /\.(jpe?g|png|webp)$/i.test(entry.name) ? [full] : [];
  });
}

async function main() {
  const source = path.resolve(process.argv[2] || DEFAULT_SOURCE);
  if (!fs.existsSync(source)) throw new Error(`No existe la carpeta de material: ${source}`);

  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
  });

  const files = listImages(source);
  let uploaded = 0;
  let skipped = 0;

  for (const file of files) {
    const relative = path.relative(source, file).replace(/\.[^.]+$/, "");
    const publicId = `${ROOT_FOLDER}/${relative.split(path.sep).join("/")}`;
    const result = await cloudinary.uploader.upload(file, {
      public_id: publicId,
      overwrite: false,
      resource_type: "image",
    });
    // Con overwrite:false Cloudinary responde `existing: true` si ya estaba.
    if (result.existing) skipped++;
    else uploaded++;
    console.log(`${result.existing ? "ya estaba" : "subido   "}  ${publicId}`);
  }

  console.log(`\nListo: ${uploaded} subidos, ${skipped} ya existían, ${files.length} en total.`);
}

main().catch((error) => {
  console.error("[upload-media]", error);
  process.exit(1);
});

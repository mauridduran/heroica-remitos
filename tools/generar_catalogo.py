"""
Catálogo de productos de los obradores (transcripto de los remitos en papel).
Genera:
  - js/catalogo.js          (datos para el modo demo)
  - supabase/seed.sql       (carga inicial en Supabase)

Uso:  python3 tools/generar_catalogo.py
Secciones: terminado | masa_sola | intermedio | materia_prima
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

AREAS = [
    # (codigo, nombre, prefijo talonario)
    ("LAM", "Laminados", "0001"),
    ("PAS", "Pastelería", "0002"),
    ("PAN", "Panadería", "0003"),
    ("GEN", "General / Insumos", "0004"),   # prefijo a confirmar
    ("COC", "Cocina", "0005"),
]

T, M, I, MP = "terminado", "masa_sola", "intermedio", "materia_prima"

CATALOGO = {
    "PAN": [
        ("Hogaza con semillas", "u", T), ("Brioche molde", "u", T), ("Pan Viena", "u", T),
        ("Ciabatta", "u", T), ("Baguette", "u", T), ("Hogaza", "u", T),
        ("Brioche hamburguesa", "u", T), ("Mini campo", "u", T), ("Mini campo con semillas", "u", T),
        ("Mini Shiku", "u", T), ("Mini brioche", "u", T), ("Baguettin", "u", T),
        ("Pan lactal", "u", T), ("Focaccia", "u", T), ("Prepizza", "u", T),
        ("Pan multigranos", "u", T), ("Pan de centeno", "u", T),
        ("Harina de fuerza", "kg", MP), ("Levadura", "kg", MP), ("Almidón de maíz", "kg", MP),
    ],
    "COC": [
        ("Carne braseada", "kg", I), ("Carne braseada con BBQ", "kg", I), ("Granola", "kg", I),
        ("Quiche entera de jamón y queso", "entera", T),
        ("Quiche entera de brócoli y cebolla caramelizada", "entera", T),
        ("Quiche entera de pollo", "entera", T),
        ("Suprema 150", "kg", I), ("Suprema 200", "kg", I), ("Milanesa de ojo de bife", "kg", I),
        ("Pollo desmenuzado", "kg", I), ("Pollo Heroica / crispy", "kg", I),
        ("Aderezo César", "kg", I), ("Aderezo Heroica", "kg", I), ("Aderezo Green", "kg", I),
        ("Nuggets", "porción x4", I), ("Medallón veggie", "u", I), ("Mezcla de huevo", "kg", I),
        ("Yogurt", "kg", I),
        ("Lechuga", "jaula", MP), ("Rúcula", "atado", MP), ("Albahaca", "atado", MP),
        ("Papas congeladas", "bolsa 2,5 kg", MP),
    ],
    "LAM": [
        ("Croissant relleno de pastelera", "u", T), ("Croissant relleno de ddl", "u", T),
        ("Medialuna dulce XL", "u", T), ("Medialuna de grasa", "u", T), ("Pan suizo", "u", T),
        ("Pan suizo almendrado", "u", T), ("Rolls NY", "u", T), ("Churrinche salado", "u", T),
        ("Churrinche dulce", "u", T), ("Cubo de pistacho", "u", T), ("Flan parisino", "u", T),
        ("Mini flan", "u", T), ("Churros", "u", T), ("Danesa", "u", T), ("Canasta frutal", "u", T),
        ("Criollitos", "u", T), ("Budín de pan", "u", T), ("Lego", "u", T),
        ("Masa de croissant", "kg", I), ("Masa de croissant cacao", "kg", I),
        ("Croissant (masa sola)", "u", M), ("Pan suizo masa sola", "u", M), ("Rolls NY masa sola", "u", M),
        ("Churrinche masa sola", "u", M), ("Cubo masa sola", "u", M), ("Flan parisino masa sola", "u", M),
        ("Mini flan masa sola", "u", M), ("Canasta masa sola", "u", M), ("Lego masa sola", "u", M),
        ("Pastelera de flan", "kg", I), ("Pastelera de yema", "kg", I), ("Pastelera de horno", "kg", I),
        ("Pistacho picado", "kg", I), ("Pasta de pistacho", "kg", I), ("Frangipane", "kg", I),
        ("Ganache de chocolate blanco", "kg", I), ("Ganache Kinder", "kg", I),
        ("Harina de fuerza", "kg", MP), ("Azúcar", "kg", MP), ("Sal", "kg", MP),
        ("Esencia de vainilla", "bidón", MP), ("Vaina de vainilla", "kg", MP), ("Almidón de maíz", "kg", MP),
        ("Yema líquida", "kg", MP), ("Manteca", "kg", MP), ("Gel de brillo", "kg", MP), ("Nutella", "kg", MP),
    ],
    "PAS": [
        ("Alfajor sablé", "u", T), ("Tapa de alfajor sablé", "u", I), ("Alfajor de chocolate", "u", T),
        ("Tapa de alfajor de chocolate", "u", I), ("Alfajor de nuez", "u", T), ("Tapa de alfajor de nuez", "u", I),
        ("Mermelada de frutos rojos", "kg", I), ("Cupcake de limón", "u", T), ("Cupcake de banana", "u", T),
        ("Cupcake de naranja y arándanos", "u", T), ("Budín de zanahoria - Carrot", "u", T),
        ("Ganache de limón", "kg", I), ("Scon de queso", "u", T), ("Chipa rueda", "u", T),
        ("Cookie vegana", "u", T), ("Cookie New York", "u", T), ("Cookie pistacho y naranja", "u", T),
        ("Cookie chocoframbuesa", "u", T), ("Cookie de chocolate y limón", "u", T),
        ("Cheesecake vasco", "u", T), ("Brownie", "u", T), ("Crumble de manzana", "u", T),
        ("Bizcocho de crumble", "u", I), ("Salsa toffee", "kg", I), ("Crumble", "u", I),
        ("Tarta tiramisú", "u", T), ("Masa sablé de cacao", "u", I), ("Mousse de mascarpone", "kg", I),
        ("Bizcocho tiramisú", "u", I), ("Tarta mousse de avellana", "u", T), ("Ganache de nutella", "kg", I),
        ("Praliné de avellanas", "kg", I), ("Tarta Balcarce", "u", T), ("Masa sablé simple", "u", I),
        ("Praliné de frutos secos", "kg", I), ("Blondie", "u", T), ("Ganache de vainilla", "kg", I),
        ("Tarta lemon pie", "u", T), ("Curd de limón", "kg", I), ("Tarta de maracuyá", "u", T),
        ("Mermelada de maracuyá", "kg", I), ("Mousse de lima", "kg", I), ("Curd de mango y maracuyá", "kg", I),
        ("Tarta de pistacho", "u", T), ("Mermelada de frambuesas", "kg", I), ("Pastelera", "kg", I),
        ("Ganache de pistacho", "kg", I), ("Tarta marquise", "u", T), ("Crema matilda", "kg", I),
        ("Bizcocho marquise", "kg", I), ("Mini pancakes", "u", T),
        ("Cobertura amarga", "kg", MP), ("Cobertura leche", "kg", MP), ("Cobertura blanco", "kg", MP),
        ("Azúcar", "kg", MP), ("Bidón de vainilla", "bidón", MP), ("Gel de brillo", "kg", MP), ("Manteca", "kg", MP),
    ],
    "GEN": [],
}

def productos():
    out = []
    for area, items in CATALOGO.items():
        for n, (nombre, unidad, seccion) in enumerate(items, 1):
            out.append({"codigo": f"{area}{n:03d}", "nombre": nombre, "unidad": unidad,
                        "seccion": seccion, "area": area})
    return out

def main():
    prods = productos()
    areas = [{"codigo": c, "nombre": n, "prefijo": p} for c, n, p in AREAS]
    (ROOT / "js" / "catalogo.js").write_text(
        "// Generado por tools/generar_catalogo.py — no editar a mano\n"
        f"export const AREAS = {json.dumps(areas, ensure_ascii=False, indent=1)};\n"
        f"export const PRODUCTOS = {json.dumps(prods, ensure_ascii=False, indent=1)};\n", encoding="utf-8")

    q = lambda s: "'" + s.replace("'", "''") + "'"
    sql = ["-- Generado por tools/generar_catalogo.py — carga inicial de áreas y productos",
           "-- Ejecutar DESPUÉS de schema.sql\n",
           "insert into areas (codigo, nombre, prefijo, orden) values"]
    sql.append(",\n".join(f"  ({q(c)}, {q(n)}, {q(p)}, {i})" for i, (c, n, p) in enumerate(AREAS)) + "\non conflict (codigo) do nothing;\n")
    sql.append("insert into products (codigo, nombre, unidad, seccion, area_id, categoria) values")
    sql.append(",\n".join(
        f"  ({q(p['codigo'])}, {q(p['nombre'])}, {q(p['unidad'])}, {q(p['seccion'])}, "
        f"(select id from areas where codigo = {q(p['area'])}), "
        f"(select nombre from areas where codigo = {q(p['area'])}))" for p in prods) + "\non conflict (codigo) do nothing;\n")
    (ROOT / "supabase" / "seed.sql").write_text("\n".join(sql), encoding="utf-8")
    print(f"{len(prods)} productos, {len(areas)} áreas")

if __name__ == "__main__":
    main()

/** Luz que percorre o contorno arredondado do card em velocidade uniforme. */
export function LaserOrbitBeam() {
  return (
    <svg className="setor-modern-laser-orbit" aria-hidden="true">
      <rect className="setor-modern-laser-orbit-tail" pathLength={100} />
      <rect className="setor-modern-laser-orbit-head" pathLength={100} />
    </svg>
  );
}

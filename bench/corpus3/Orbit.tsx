type Props = { tone?: "gold" | "blue" };
export default function Orbit({tone="gold"}: Props){return <button style={{background:tone==="gold"?"#f0bd45":"#154f65",padding:24}}>Launch 731</button>}

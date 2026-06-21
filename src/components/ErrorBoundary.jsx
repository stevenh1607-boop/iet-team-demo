import { Component } from "react";

// ── ERROR BOUNDARY ───────────────────────────────────────────────
// Catches any unhandled render errors and shows a recovery screen
// instead of a blank page.
class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error:null, info:null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { this.setState({ error, info }); }
  render() {
    if (this.state.error) {
      return (
        <div style={{fontFamily:"monospace",padding:"2rem",maxWidth:"700px",margin:"2rem auto"}}>
          <div style={{background:"#FEF2F2",border:"1px solid #FECACA",borderRadius:"8px",padding:"1.5rem"}}>
            <div style={{fontWeight:"bold",color:"#991B1B",fontSize:"16px",marginBottom:"8px"}}>
              ⚠️ IET Estimation Tool — Render Error
            </div>
            <div style={{color:"#7F1D1D",fontSize:"13px",marginBottom:"12px"}}>
              {this.state.error?.message || "Unknown error"}
            </div>
            <details style={{fontSize:"11px",color:"#9CA3AF"}}>
              <summary style={{cursor:"pointer",marginBottom:"6px"}}>Stack trace</summary>
              <pre style={{overflow:"auto",maxHeight:"200px",background:"#F9FAFB",padding:"8px",borderRadius:"4px"}}>
                {this.state.error?.stack}
              </pre>
            </details>
            <button
              onClick={() => { this.setState({error:null,info:null}); window.location.reload(); }}
              style={{marginTop:"12px",background:"#1e3a5f",color:"#fff",border:"none",borderRadius:"6px",padding:"8px 16px",cursor:"pointer",fontSize:"12px"}}>
              🔄 Reload App
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;

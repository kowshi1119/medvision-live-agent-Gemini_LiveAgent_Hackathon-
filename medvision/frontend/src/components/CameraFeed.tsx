import React from 'react';

interface CameraFeedProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  isCameraOn: boolean;
  toggleCamera: () => void;
  isSpeaking: boolean;
}

export const CameraFeed: React.FC<CameraFeedProps> = ({ videoRef, isCameraOn, toggleCamera, isSpeaking }) => {
  return (
    <div style={{position:'relative',width:'100%',aspectRatio:'16/9',
                 background:'var(--surface)',overflow:'hidden',
                 border: isSpeaking
                   ? '1px solid var(--green)'
                   : '1px solid var(--border)',
                 borderRadius:3}}>

      <video ref={videoRef} autoPlay muted playsInline
        style={{position:'absolute',inset:0,width:'100%',height:'100%',
                objectFit:'cover',display:isCameraOn?'block':'none'}} />

      <div style={{position:'absolute',inset:0,pointerEvents:'none',zIndex:2,
                   backgroundImage:'repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.06) 2px,rgba(0,0,0,0.06) 4px)',
                   backgroundSize:'100% 4px',
                   animation:'scan 10s linear infinite'}} />

      {!isCameraOn && (
        <div style={{position:'absolute',inset:0,zIndex:3,
                     display:'flex',flexDirection:'column',
                     alignItems:'center',justifyContent:'center',
                     background:'var(--surface)'}}>
          <span style={{fontSize:32,opacity:.3,marginBottom:8}}>📵</span>
          <span style={{fontFamily:"'Space Mono',monospace",fontSize:10,
                        color:'var(--dim)',letterSpacing:2}}>CAMERA OFF</span>
        </div>
      )}

      <button onClick={toggleCamera} aria-label={isCameraOn?'Camera off':'Camera on'}
        style={{position:'absolute',top:6,right:6,zIndex:4,
                background:'rgba(8,11,20,0.85)',
                border:`1px solid ${isCameraOn?'var(--green)':'var(--red)'}`,
                color:isCameraOn?'var(--green)':'var(--red)',
                borderRadius:2,padding:'2px 7px',
                fontFamily:"'Space Mono',monospace",fontSize:9,
                letterSpacing:1,cursor:'pointer'}}>
        {isCameraOn ? '📷 ON' : '📷 OFF'}
      </button>
    </div>
  );
};


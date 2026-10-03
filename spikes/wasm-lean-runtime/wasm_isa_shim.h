// SPIKE-ONLY shim. Emscripten's SSE compat layer lacks FMA3 and MXCSR.
// Real port must use per-lane std::fma (exactness) and a no-op FP env.
#pragma once
#include <immintrin.h>
#include <cmath>
static inline __m128 _mm_fmadd_ps(__m128 a, __m128 b, __m128 c) {
  float x[4], y[4], z[4], r[4];
  _mm_storeu_ps(x,a); _mm_storeu_ps(y,b); _mm_storeu_ps(z,c);
  for (int i=0;i<4;i++) r[i] = std::fma(x[i],y[i],z[i]);
  return _mm_loadu_ps(r);
}
static inline __m128 _mm_fmsub_ps(__m128 a, __m128 b, __m128 c) {
  float x[4], y[4], z[4], r[4];
  _mm_storeu_ps(x,a); _mm_storeu_ps(y,b); _mm_storeu_ps(z,c);
  for (int i=0;i<4;i++) r[i] = std::fma(x[i],y[i],-z[i]);
  return _mm_loadu_ps(r);
}

static inline void _mm_setcsr(unsigned int) {}

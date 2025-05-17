class GameLogic {
  constructor() {
    this.map = null;
    this.vectorSource = null;
    this.markerAddingDisabled = false;
    this.currentQuestion = null;
    this.currentCallback = null;
    this.featuresLoaded = false;
  }

  loadMapCSSAndJS(callback) {
    const cssLink = document.createElement("link");
    cssLink.rel = "stylesheet";
    cssLink.href = "https://openlayers.org/en/v4.6.5/css/ol.css";
    document.head.appendChild(cssLink);

    const jsScript = document.createElement("script");
    jsScript.src = "https://openlayers.org/en/v4.6.5/build/ol.js";
    jsScript.onload = callback;
    document.head.appendChild(jsScript);
  }

  initializeMap(targetId) {
    this.makeImageDraggable();

    this.vectorSource = new ol.source.Vector({
      format: new ol.format.GeoJSON(),
    });

    fetch(
      "https://raw.githubusercontent.com/adimail/fun-with-flags/refs/heads/master/frontend/static/countries.geo.json",
    )
      .then((response) => response.json())
      .then((data) => {
        const features = this.vectorSource.getFormat().readFeatures(data, {
          featureProjection: "EPSG:3857",
        });
        this.vectorSource.addFeatures(features);
        this.featuresLoaded = true;
      });

    const vectorLayer = new ol.layer.Vector({
      source: this.vectorSource,
      style: new ol.style.Style({
        stroke: new ol.style.Stroke({
          color: "rgba(80, 120, 200, 0.8)",
          width: 1.5,
        }),
        fill: new ol.style.Fill({
          color: "rgba(173, 216, 230, 0.6)",
        }),
      }),
      updateWhileAnimating: true,
      updateWhileInteracting: true,
      renderBuffer: 200,
    });

    const highlightSource = new ol.source.Vector();
    const highlightLayer = new ol.layer.Vector({
      source: highlightSource,
      style: new ol.style.Style({
        stroke: new ol.style.Stroke({
          color: "#32CD32",
          width: 3,
        }),
        fill: new ol.style.Fill({
          color: "rgba(50, 205, 50, 0.3)",
        }),
      }),
    });

    const extent = ol.proj.transformExtent(
      [-180, -85, 180, 85],
      "EPSG:4326",
      "EPSG:3857",
    );

    this.map = new ol.Map({
      target: targetId,
      layers: [vectorLayer, highlightLayer],
      view: new ol.View({
        center: ol.proj.fromLonLat([0, 0]),
        zoom: 3,
        minZoom: 2.5,
        maxZoom: 5,
        extent: extent,
      }),
      pixelRatio: 1,
      loadTilesWhileAnimating: true,
      loadTilesWhileInteracting: true,
    });

    let disableHover = false;

    this.map.on("pointermove", (event) => {
      if (disableHover || !this.featuresLoaded) return;
      highlightSource.clear();
      this.map.forEachFeatureAtPixel(event.pixel, (feature) => {
        const geometry = feature.getGeometry();
        const clonedFeature = feature.clone();
        clonedFeature.setGeometry(geometry);
        highlightSource.addFeature(clonedFeature);
      });
    });

    this.map.on("click", (event) => {
      if (!this.currentQuestion || this.markerAddingDisabled) return;

      const clickedFeature = this.map.forEachFeatureAtPixel(
        event.pixel,
        (feature) => feature,
      );

      if (clickedFeature) {
        const userSelectedCountry = clickedFeature.get("name");

        this.handleMapClick(userSelectedCountry, this.currentQuestion.answer);
      }
    });
  }

  handleMapClick(userSelectedCountry, correctAnswer) {
    if (this.markerAddingDisabled) return;

    const isCorrect = correctAnswer === userSelectedCountry;
    this.markerAddingDisabled = true;

    if (isCorrect) {
      this.highlightCountry(
        userSelectedCountry,
        "rgba(50, 205, 50, 0.6)",
        "#32CD32",
      );
    } else {
      this.highlightCountry(
        userSelectedCountry,
        "rgba(255, 0, 0, 0.6)",
        "#FF0000",
      );
      this.highlightCountry(correctAnswer, "rgba(50, 205, 50, 0.6)", "#32CD32");
    }

    this.fitCountriesInView(userSelectedCountry, correctAnswer, () => {
      this.addTooltip(
        userSelectedCountry,
        isCorrect ? "rgba(50, 205, 50, 0.8)" : "rgba(255, 0, 0, 0.8)",
      );

      if (!isCorrect) {
        this.addTooltip(correctAnswer, "rgba(50, 205, 50, 0.8)");
      }
    });

    setTimeout(() => {
      this.markerAddingDisabled = false;
      if (this.currentCallback) {
        this.currentCallback(isCorrect, userSelectedCountry, correctAnswer);
      }
    }, 4000);
  }

  fitCountriesInView(country1, country2, callback) {
    const features = this.vectorSource.getFeatures();
    const feature1 = features.find((f) => f.get("name") === country1);
    const feature2 = features.find((f) => f.get("name") === country2);

    if (feature1 && feature2) {
      const extent1 = feature1.getGeometry().getExtent();
      const extent2 = feature2.getGeometry().getExtent();
      const combinedExtent = ol.extent.extend(extent1, extent2);

      this.map.getView().fit(combinedExtent, {
        duration: 500,
        padding: [50, 50, 50, 50],
      });

      setTimeout(callback, 500);
    } else {
      console.warn(
        `One or both countries ('${country1}', '${country2}') not found in the map source.`,
      );
    }
  }

  addTooltip(countryName, backgroundColor) {
    const features = this.vectorSource.getFeatures();
    const feature = features.find((f) => f.get("name") === countryName);

    if (feature) {
      const geometry = feature.getGeometry();
      const extent = geometry.getExtent();
      const center = ol.extent.getCenter(extent);

      const tooltipElement = document.createElement("div");
      tooltipElement.style.position = "absolute";
      tooltipElement.style.color = "white";
      tooltipElement.style.background = backgroundColor;
      tooltipElement.style.padding = "5px 10px";
      tooltipElement.style.borderRadius = "4px";
      tooltipElement.style.border = "1px solid black";
      tooltipElement.style.fontSize = "15px";
      tooltipElement.style.whiteSpace = "nowrap";
      tooltipElement.textContent = countryName;

      const tooltipOverlay = new ol.Overlay({
        element: tooltipElement,
        position: center,
        positioning: "center-center",
        stopEvent: false,
      });

      this.map.addOverlay(tooltipOverlay);

      setTimeout(() => {
        this.map.removeOverlay(tooltipOverlay);
      }, 3500);
    } else {
      console.warn(`Country '${countryName}' not found in the map source.`);
    }
  }

  shuffleOptions(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  markAnswer(button, isCorrect) {
    button.style.backgroundColor = isCorrect ? "#a8d5a2" : "#f5a9a9";
    button.style.color = "#333";
  }

  updateProgress(progressElement, currentIndex, totalQuestions) {
    progressElement.textContent = `Question ${currentIndex + 1} of ${totalQuestions}`;
  }

  handleAnswer(selectedButton, correctAnswer, markAnswer, callback) {
    const buttons = document.querySelectorAll(".option");
    buttons.forEach((button) => (button.disabled = true));
    const isCorrect = selectedButton.textContent === correctAnswer;

    selectedButton.style.backgroundColor = isCorrect ? "#a8d5a2" : "#f5a9a9";
    selectedButton.style.color = "#333";

    if (!isCorrect) {
      const correctButton = Array.from(buttons).find(
        (button) => button.textContent === correctAnswer,
      );
      if (correctButton) markAnswer(correctButton, true);
    }

    setTimeout(() => {
      buttons.forEach((button) => (button.disabled = false));
      callback(isCorrect);
    }, 2000);
  }

  loadMapQuestion(mapElement, flagElement, question, callback) {
    mapElement.classList.remove("hidden");
    flagElement.src = question.flag_url;
    this.currentQuestion = question;
    this.currentCallback = callback;
  }

  loadMCQQuestion(
    flagElement,
    optionsElement,
    question,
    callback,
    handleAnswer,
  ) {
    flagElement.src = question.flag_url;
    const optionsArray = [...question.options];
    this.shuffleOptions(optionsArray);

    optionsElement.innerHTML = optionsArray
      .map((option) => `<button class="option">${option}</button>`)
      .join("");

    Array.from(optionsElement.children).forEach((button) => {
      button.onclick = () =>
        handleAnswer(button, question.answer, this.markAnswer, callback);
    });
  }

  highlightCountry(countryName, backgroundColor, borderColor) {
    const highlightSource = new ol.source.Vector();
    const highlightLayer = new ol.layer.Vector({
      source: highlightSource,
      style: new ol.style.Style({
        stroke: new ol.style.Stroke({
          color: borderColor,
          width: 3,
        }),
        fill: new ol.style.Fill({
          color: backgroundColor,
        }),
      }),
    });

    if (!this.map.getLayers().getArray().includes(highlightLayer)) {
      this.map.addLayer(highlightLayer);
    }

    highlightSource.clear();

    const features = this.vectorSource.getFeatures();
    const feature = features.find((f) => f.get("name") === countryName);

    if (feature) {
      const geometry = feature.getGeometry();
      const clonedFeature = feature.clone();
      clonedFeature.setGeometry(geometry);
      highlightSource.addFeature(clonedFeature);

      setTimeout(() => {
        highlightSource.clear();
      }, 4000);
    } else {
      console.warn(`Country '${countryName}' not found in the map source.`);
    }
  }

  makeImageDraggable() {
    const flagMap = document.getElementById("flag-map");
    if (!flagMap) return;
    let offsetX, offsetY;
    flagMap.style.position = "absolute";
    const moveImage = (clientX, clientY) => {
      const minX = 0;
      const minY = 0;
      const maxX = window.innerWidth - flagMap.offsetWidth;
      const maxY = window.innerHeight - flagMap.offsetHeight;
      let newLeft = clientX - offsetX;
      let newTop = clientY - offsetY;

      newLeft = Math.max(minX, Math.min(maxX, newLeft));
      newTop = Math.max(minY, Math.min(maxY, newTop));

      flagMap.style.left = `${newLeft}px`;
      flagMap.style.top = `${newTop}px`;
    };

    flagMap.addEventListener("mousedown", (e) => {
      offsetX = e.clientX - flagMap.offsetLeft;
      offsetY = e.clientY - flagMap.offsetTop;

      const onMouseMove = (moveEvent) => {
        moveImage(moveEvent.clientX, moveEvent.clientY);
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    });

    flagMap.addEventListener("touchstart", (e) => {
      e.preventDefault();
      const touch = e.touches[0];
      offsetX = touch.clientX - flagMap.offsetLeft;
      offsetY = touch.clientY - flagMap.offsetTop;

      const onTouchMove = (moveEvent) => {
        const touch = moveEvent.touches[0];
        moveImage(touch.clientX, touch.clientY);
      };

      const onTouchEnd = () => {
        document.removeEventListener("touchmove", onTouchMove);
        document.removeEventListener("touchend", onTouchEnd);
      };

      document.addEventListener("touchmove", onTouchMove);
      document.addEventListener("touchend", onTouchEnd);
    });
  }
}

export default GameLogic;
